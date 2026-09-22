package engine

import (
	"archive/zip"
	"bytes"
	"github.com/xuri/excelize/v2"
	"io"
	"regexp"
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

// Dependency regression bypasses our preflight deliberately: verify the pinned
// upstream library itself handles the reported invalid-index panic safely.
func TestPinnedDependencyRejectsNegativeSharedStringIndex(t *testing.T) {
	for _, index := range []string{"-1", "-2147483648", "999999"} {
		t.Run(index, func(t *testing.T) {
			original := fixture(t)
			z, err := zip.NewReader(bytes.NewReader(original), int64(len(original)))
			if err != nil {
				t.Fatal(err)
			}
			var b bytes.Buffer
			out := zip.NewWriter(&b)
			replaced := false
			for _, entry := range z.File {
				r, err := entry.Open()
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(r)
				r.Close()
				if err != nil {
					t.Fatal(err)
				}
				if entry.Name == "xl/worksheets/sheet1.xml" {
					re := regexp.MustCompile(`<c r="A1"[^>]*>.*?</c>`)
					next := re.ReplaceAll(data, []byte(`<c r="A1" t="s"><v>`+index+`</v></c>`))
					replaced = !bytes.Equal(data, next)
					data = next
				}
				w, err := out.Create(entry.Name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = w.Write(data); err != nil {
					t.Fatal(err)
				}
			}
			if err = out.Close(); err != nil {
				t.Fatal(err)
			}
			if !replaced {
				t.Fatal("malicious cell was not injected")
			}
			for _, operation := range []string{"read", "calculate", "update", "chart", "pivot"} {
				if _, err := Process(Request{Operation: operation, Workbook: b.Bytes()}); err == nil || !strings.Contains(err.Error(), "shared-string index") {
					t.Fatalf("%s did not reject shared-string index in preflight: %v", operation, err)
				}
			}
			f, err := excelize.OpenReader(bytes.NewReader(b.Bytes()))
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			value, err := f.GetCellValue("Sheet1", "A1")
			if err == nil || !strings.Contains(err.Error(), "invalid shared string index") || value != "" {
				t.Fatalf("upstream accepted invalid index: %q %v", value, err)
			}
		})
	}
}
