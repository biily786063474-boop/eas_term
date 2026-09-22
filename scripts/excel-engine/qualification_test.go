package engine

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// These tests qualify the actual engine, not a mock or a market card.
func TestNativeAnalyticsSurviveCellEdit(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	rows := [][]interface{}{{"Region", "Product", "Sales"}, {"East", "A", 10}, {"East", "B", 20}, {"West", "A", 30}}
	for i, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow("Sheet1", cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.NewSheet("Summary"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellFormula("Summary", "A1", "SUM(Sheet1!C2:C4)"); err != nil {
		t.Fatal(err)
	}
	if got, err := f.CalcCellValue("Summary", "A1"); err != nil || got != "60" {
		t.Fatalf("cross-sheet formula = %q, %v", got, err)
	}
	if err := f.AddPivotTable(&excelize.PivotTableOptions{
		DataRange: "Sheet1!A1:C4", PivotTableRange: "Summary!A4:D12", Name: "SalesPivot",
		Rows: []excelize.PivotTableField{{Data: "Region"}}, Columns: []excelize.PivotTableField{{Data: "Product"}},
		Data: []excelize.PivotTableField{{Data: "Sales", Name: "Total", Subtotal: "Sum"}}, RowGrandTotals: true, ColGrandTotals: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.AddChart("Summary", "F2", &excelize.Chart{Type: excelize.Col, Series: []excelize.ChartSeries{{Name: "Sheet1!$C$1", Categories: "Sheet1!$A$2:$A$4", Values: "Sheet1!$C$2:$C$4"}}}); err != nil {
		t.Fatal(err)
	}
	b, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	assertNativeParts(t, b.Bytes())
	reopened, err := excelize.OpenReader(bytes.NewReader(b.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.SetCellInt("Sheet1", "C2", 40); err != nil {
		t.Fatal(err)
	}
	if got, err := reopened.CalcCellValue("Summary", "A1"); err != nil || got != "90" {
		t.Fatalf("updated dependency = %q, %v", got, err)
	}
	pivots, err := reopened.GetPivotTables("Summary")
	if err != nil || len(pivots) != 1 || pivots[0].Name != "SalesPivot" {
		t.Fatalf("pivot not retained: %+v %v", pivots, err)
	}
	after, err := reopened.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	assertNativeParts(t, after.Bytes())
}
func assertNativeParts(t *testing.T, b []byte) {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, f := range r.File {
		names = append(names, f.Name)
	}
	for _, prefix := range []string{"xl/charts/chart", "xl/pivotTables/pivotTable", "xl/pivotCache/pivotCacheDefinition"} {
		found := false
		for _, n := range names {
			if strings.HasPrefix(n, prefix) && strings.HasSuffix(n, ".xml") {
				found = true
			}
		}
		if !found {
			t.Fatal("missing native OOXML: " + prefix)
		}
	}
}
func TestCalculationErrorsAreNotReportedAsSuccess(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetCellFormula("Sheet1", "A1", "1/0"); err != nil {
		t.Fatal(err)
	}
	got, err := f.CalcCellValue("Sheet1", "A1")
	if err == nil && got != "#DIV/0!" {
		t.Fatalf("division by zero silently accepted: %q %v", got, err)
	}
}

func TestRecalculationAfterMutationDoesNotReturnOldResult(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetCellInt("Sheet1", "A1", 10); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellFormula("Sheet1", "A2", "A1*2"); err != nil {
		t.Fatal(err)
	}
	if got, err := f.CalcCellValue("Sheet1", "A2"); err != nil || got != "20" {
		t.Fatalf("initial calculation %q %v", got, err)
	}
	if err := f.SetCellInt("Sheet1", "A1", 40); err != nil {
		t.Fatal(err)
	}
	if got, err := f.CalcCellValue("Sheet1", "A2"); err != nil || got != "80" {
		t.Fatalf("stale calculation %q %v", got, err)
	}
}
