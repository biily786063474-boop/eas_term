package engine

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"testing"
)

func TestChartNamesAreLiteralAndSurviveUpdate(t *testing.T) {
	name := `营收 & <预算> "2026"`
	r, e := Process(Request{Operation: "chart", Workbook: fixture(t), Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Name: name, Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}})
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		z, _ := zip.NewReader(bytes.NewReader(r.Workbook), int64(len(r.Workbook)))
		found := false
		for _, p := range z.File {
			if p.Name != "xl/charts/chart1.xml" {
				continue
			}
			rc, _ := p.Open()
			d := xml.NewDecoder(rc)
			inTx := false
			for {
				tok, e := d.Token()
				if e == io.EOF {
					break
				}
				if e != nil {
					t.Fatal(e)
				}
				switch v := tok.(type) {
				case xml.StartElement:
					if v.Name.Local == "tx" {
						inTx = true
					}
					if inTx && v.Name.Local == "strRef" {
						t.Fatal("literal name encoded as formula reference")
					}
					if inTx && v.Name.Local == "v" {
						var got string
						if e = d.DecodeElement(&got, &v); e != nil || got != name {
							t.Fatalf("name %q %v", got, e)
						}
						found = true
					}
				case xml.EndElement:
					if v.Name.Local == "tx" {
						inTx = false
					}
				}
			}
			rc.Close()
		}
		if !found {
			t.Fatal("literal chart name missing")
		}
		if i == 0 {
			r, e = Process(Request{Operation: "update", Workbook: r.Workbook, Sheet: "Sheet1", Changes: []Change{{Cell: "B2", Value: 40.0}}})
			if e != nil {
				t.Fatal(e)
			}
		}
	}
}

func TestLiteralNamesOnlyChangeNewChart(t *testing.T) {
	first, e := Process(Request{Operation: "chart", Workbook: fixture(t), Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "line", Name: "旧图", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}})
	if e != nil {
		t.Fatal(e)
	}
	second, e := Process(Request{Operation: "chart", Workbook: first.Workbook, Sheet: "Sheet1", Cell: "F18", Chart: &ChartSpec{Type: "column", Series: []ChartSeries{{Name: "新图一", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}, {Name: "新图二", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}}}})
	if e != nil {
		t.Fatal(e)
	}
	part := func(b []byte) []byte {
		z, _ := zip.NewReader(bytes.NewReader(b), int64(len(b)))
		for _, p := range z.File {
			if p.Name == "xl/charts/chart1.xml" {
				rc, _ := p.Open()
				defer rc.Close()
				v, _ := io.ReadAll(rc)
				return v
			}
		}
		t.Fatal("missing old chart")
		return nil
	}
	if !bytes.Equal(part(first.Workbook), part(second.Workbook)) {
		t.Fatal("old chart changed")
	}
}
