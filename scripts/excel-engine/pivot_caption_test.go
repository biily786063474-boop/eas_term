package engine

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func TestPivotValueCaptionIsExplicit(t *testing.T) {
	r, err := Process(Request{Operation: "pivot", Workbook: fixture(t), Pivot: &PivotSpec{Source: "Sheet1!A1:B3", Destination: "Sheet1!J1:M12", Name: "Totals", Rows: []string{"Region"}, Data: []PivotValue{{Field: "Amount", Aggregate: "Sum"}}}})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(r.Workbook), int64(len(r.Workbook)))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range z.File {
		if !strings.HasPrefix(f.Name, "xl/pivotTables/pivotTable") || !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		var doc struct {
			Fields []struct {
				Name string `xml:"name,attr"`
			} `xml:"dataFields>dataField"`
		}
		if err = xml.Unmarshal(b, &doc); err != nil {
			t.Fatal(err)
		}
		for _, field := range doc.Fields {
			found = true
			if field.Name != "Sum of Amount" {
				t.Fatalf("blank or ambiguous pivot caption: %q", field.Name)
			}
		}
	}
	if !found {
		t.Fatal("missing native pivot data field")
	}
}
