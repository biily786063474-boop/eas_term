package engine

import (
	"bytes"
	"github.com/xuri/excelize/v2"
	"os"
	"testing"
)

func TestUpdateInvalidatesWPSFormulaCache(t *testing.T) {
	b, e := os.ReadFile("../../docs/verification/plugin-marketplace/excel-real/wps-saved-before-update.xlsx")
	if e != nil {
		t.Fatal(e)
	}
	r, e := Process(Request{Operation: "update", Workbook: b, Sheet: "Data", Changes: []Change{{Cell: "B2", Value: float64(40)}}})
	if e != nil {
		t.Fatal(e)
	}
	f, e := excelize.OpenReader(bytes.NewReader(r.Workbook))
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	formula, e := f.GetCellFormula("Data", "E2")
	if e != nil || formula != "SUM(B2:B4)" {
		t.Fatalf("formula changed: %s %v", formula, e)
	}
	cached, e := f.GetCellValue("Data", "E2")
	if e != nil || cached != "" {
		t.Fatalf("stale cache survives update: %q %v", cached, e)
	}
	value, e := f.CalcCellValue("Data", "E2")
	if e != nil || value != "90" {
		t.Fatalf("calculation: %s %v", value, e)
	}
}
