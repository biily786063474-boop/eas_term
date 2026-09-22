package engine

import (
	"archive/zip"
	"bytes"
	"github.com/xuri/excelize/v2"
	"testing"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	for i, r := range [][]interface{}{{"Region", "Amount"}, {"East", 10}, {"West", 20}} {
		a, _ := excelize.CoordinatesToCellName(1, i+1)
		if e := f.SetSheetRow("Sheet1", a, &r); e != nil {
			t.Fatal(e)
		}
	}
	if e := f.SetCellFormula("Sheet1", "D1", "SUM(B2:B3)"); e != nil {
		t.Fatal(e)
	}
	b, e := f.WriteToBuffer()
	if e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}
func TestProcessCalculatesAndPreservesAnalytics(t *testing.T) {
	b := fixture(t)
	r, e := Process(Request{Operation: "calculate", Workbook: b, Sheet: "Sheet1", Cell: "D1"})
	if e != nil || r.Value != "30" {
		t.Fatalf("%+v %v", r, e)
	}
	r, e = Process(Request{Operation: "chart", Workbook: b, Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Categories: "Sheet1!$A$2:$A$3", Values: "Sheet1!$B$2:$B$3", Name: "Amount"}})
	if e != nil {
		t.Fatal(e)
	}
	r, e = Process(Request{Operation: "pivot", Workbook: r.Workbook, Pivot: &PivotSpec{Source: "Sheet1!A1:B3", Destination: "Sheet1!J1:M12", Name: "RegionTotals", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}})
	if e != nil {
		t.Fatal(e)
	}
	r, e = Process(Request{Operation: "update", Workbook: r.Workbook, Sheet: "Sheet1", Changes: []Change{{Cell: "B2", Value: 40.0}}})
	if e != nil {
		t.Fatal(e)
	}
	assertNativeParts(t, r.Workbook)
	c, e := Process(Request{Operation: "calculate", Workbook: r.Workbook, Sheet: "Sheet1", Cell: "D1"})
	if e != nil || c.Value != "60" {
		t.Fatalf("%+v %v", c, e)
	}
}
func TestProcessRejectsUnsafeInputs(t *testing.T) {
	b := fixture(t)
	for _, r := range []Request{
		{Operation: "unknown", Workbook: b},
		{Operation: "chart", Workbook: b, Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Categories: "[outside.xlsx]Sheet1!A1:A2", Values: "Sheet1!B1:B2"}},
		{Operation: "calculate", Workbook: b, Sheet: "Sheet1", Cell: "ZZZ99999"},
		{Operation: "update", Workbook: b, Sheet: "Sheet1", Changes: []Change{{Cell: "A1", Formula: "WEBSERVICE(\"https://evil.test\")"}}},
	} {
		if _, e := Process(r); e == nil {
			t.Fatalf("unsafe request accepted: %+v", r.Operation)
		}
	}
	for _, content := range []struct{ name, body string }{
		{"xl/externalLinks/externalLink1.xml", "<x/>"},
		{"xl/worksheets/out-of-bounds.xml", `<worksheet><sheetData><row r="10001"/></sheetData></worksheet>`},
		{"xl/worksheets/wide.xml", `<worksheet><cols><col min="1" max="1001"/></cols></worksheet>`},
		{"xl/_rels/malicious.rels", `<Relationships><Relationship TargetMode="External" Target="https://evil.test"/></Relationships>`},
		{"xl/evil.xml", `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x>&e;</x>`},
		{"xl/_rels/active.rels", `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="sharedStrings.xml"/></Relationships>`},
	} {
		if _, e := Process(Request{Operation: "calculate", Workbook: appendPart(t, b, content.name, content.body), Sheet: "Sheet1", Cell: "D1"}); e == nil {
			t.Fatal("unsafe archive accepted: " + content.name)
		}
	}
}
func appendPart(t *testing.T, b []byte, name, body string) []byte {
	t.Helper()
	r, e := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if e != nil {
		t.Fatal(e)
	}
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for _, f := range r.File {
		if e = w.Copy(f); e != nil {
			t.Fatal(e)
		}
	}
	f, e := w.Create(name)
	if e != nil {
		t.Fatal(e)
	}
	f.Write([]byte(body))
	if e = w.Close(); e != nil {
		t.Fatal(e)
	}
	return out.Bytes()
}
