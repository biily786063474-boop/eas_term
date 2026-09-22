package engine

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestSharedStringIndexPreflight(t *testing.T) {
	for _, index := range []string{"-1", "-2147483648", "999999999999999999999999", "bad", "&#45;1"} {
		t.Run(index, func(t *testing.T) {
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			w, _ := z.Create("xl/workbook.xml")
			w.Write([]byte(`<workbook/>`))
			w, _ = z.Create("xl/worksheets/sheet1.xml")
			w.Write([]byte(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>` + index + `</v></c></row></sheetData></worksheet>`))
			z.Close()
			if err := validateArchive(b.Bytes()); err == nil || !strings.Contains(err.Error(), "shared-string index") {
				t.Fatalf("unsafe index not rejected: %v", err)
			}
		})
	}
}
