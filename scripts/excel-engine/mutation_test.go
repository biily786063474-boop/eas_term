package engine

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"github.com/xuri/excelize/v2"
	"io"
	"testing"
)

func TestUpdateClearsFormulaAndRejectsMergedCells(t *testing.T) {
	for _, v := range []interface{}{nil, 42.0, "plain", false} {
		r, e := Process(Request{Operation: "update", Workbook: fixture(t), Sheet: "Sheet1", Changes: []Change{{Cell: "D1", Value: v}}})
		if e != nil {
			t.Fatal(e)
		}
		f, e := excelize.OpenReader(bytes.NewReader(r.Workbook))
		if e != nil {
			t.Fatal(e)
		}
		formula, e := f.GetCellFormula("Sheet1", "D1")
		f.Close()
		if e != nil || formula != "" {
			t.Fatalf("old formula retained for %v: %s %v", v, formula, e)
		}
	}
	f := excelize.NewFile()
	defer f.Close()
	f.SetCellValue("Sheet1", "A1", "keep")
	f.MergeCell("Sheet1", "A1", "B2")
	b, _ := f.WriteToBuffer()
	for _, a := range []string{"A1", "B2"} {
		if _, e := Process(Request{Operation: "update", Workbook: b.Bytes(), Sheet: "Sheet1", Changes: []Change{{Cell: a, Value: "bad"}}}); e == nil {
			t.Fatal("merged cell accepted " + a)
		}
	}
}
func TestChartMultipleSeries(t *testing.T) {
	r, e := Process(Request{Operation: "chart", Workbook: fixture(t), Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Series: []ChartSeries{{Name: "One", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}, {Name: "Two", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}}}})
	if e != nil {
		t.Fatal(e)
	}
	z, _ := zip.NewReader(bytes.NewReader(r.Workbook), int64(len(r.Workbook)))
	found := false
	for _, part := range z.File {
		if part.Name == "xl/charts/chart1.xml" {
			rc, _ := part.Open()
			data, _ := io.ReadAll(rc)
			rc.Close()
			decoder := xml.NewDecoder(bytes.NewReader(data))
			count := 0
			for {
				tok, err := decoder.Token()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				if el, ok := tok.(xml.StartElement); ok && el.Name.Local == "ser" {
					count++
				}
			}
			if count != 2 {
				t.Fatalf("expected two native series: %s", data)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("missing native chart")
	}

}
func TestChartRejectsMismatchedVector(t *testing.T) {
	_, e := Process(Request{Operation: "chart", Workbook: fixture(t), Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Categories: "Sheet1!A1:A3", Values: "Sheet1!B2:B3"}})
	if e == nil {
		t.Fatal("mismatched chart accepted")
	}
}
func TestPivotRejectsSourceAndOccupiedDestination(t *testing.T) {
	for _, dest := range []string{"Sheet1!A1:C12", "Sheet1!D1:G12"} {
		_, e := Process(Request{Operation: "pivot", Workbook: fixture(t), Pivot: &PivotSpec{Source: "Sheet1!A1:B3", Destination: dest, Name: "Totals", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}})
		if e == nil {
			t.Fatal("occupied pivot accepted " + dest)
		}
	}
}

func TestPivotRejectsExistingUnrefreshedPivot(t *testing.T) {
	p := &PivotSpec{Source: "Sheet1!A1:B3", Destination: "Sheet1!J1:M12", Name: "First", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}
	r, e := Process(Request{Operation: "pivot", Workbook: fixture(t), Pivot: p})
	if e != nil {
		t.Fatal(e)
	}
	p.Name = "Second"
	if _, e = Process(Request{Operation: "pivot", Workbook: r.Workbook, Pivot: p}); e == nil {
		t.Fatal("overlapping unrefreshed pivot accepted")
	}
}

func TestPivotRejectsUndersizedRefreshReservation(t *testing.T) {
	for _, dest := range []string{"Sheet1!J1:K2", "Sheet1!J1:K12", "Sheet1!J1:M3"} {
		_, e := Process(Request{Operation: "pivot", Workbook: fixture(t), Pivot: &PivotSpec{Source: "Sheet1!A1:B3", Destination: dest, Name: "Totals", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}})
		if e == nil {
			t.Fatal("undersized refresh reservation accepted: " + dest)
		}
	}
}
func TestUpdateRejectsPivotOutputReservation(t *testing.T) {
	r, e := Process(Request{Operation: "pivot", Workbook: fixture(t), Pivot: &PivotSpec{Source: "Sheet1!A1:B3", Destination: "Sheet1!J1:M12", Name: "Totals", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}})
	if e != nil {
		t.Fatal(e)
	}
	for _, cell := range []string{"J1", "M12"} {
		if _, e = Process(Request{Operation: "update", Workbook: r.Workbook, Sheet: "Sheet1", Changes: []Change{{Cell: cell, Value: "would be overwritten"}}}); e == nil {
			t.Fatal("pivot output update accepted: " + cell)
		}
	}
	if _, e = Process(Request{Operation: "update", Workbook: r.Workbook, Sheet: "Sheet1", Changes: []Change{{Cell: "B2", Value: 45.0}}}); e != nil {
		t.Fatal("source update should remain supported", e)
	}
}

func TestPivotReservationIncludesColumnGroupsAndMultipleValues(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	p := &PivotSpec{Source: "Sheet1!A1:D4", Destination: "Sheet1!J1:Q20", Rows: []string{"Region"}, Columns: []string{"Month"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}, {Field: "Units", Aggregate: "Sum"}}}
	if e := pivotDestination(f, p); e == nil {
		t.Fatal("column/value expansion accepted in narrow range")
	}
	p.Destination = "Sheet1!J1:Z20"
	if e := pivotDestination(f, p); e != nil {
		t.Fatal("sufficient empty reservation rejected", e)
	}
	f.SetCellValue("Sheet1", "Y19", "keep outside current summary")
	if e := pivotDestination(f, p); e == nil {
		t.Fatal("occupied future refresh reservation accepted")
	}
}
