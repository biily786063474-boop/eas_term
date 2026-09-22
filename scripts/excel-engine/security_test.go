package engine

import (
	"archive/zip"
	"bytes"
	"fmt"
	"github.com/xuri/excelize/v2"
	"io"
	"os"
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

// Positive control proves the temporary-file observation actually sees a spill;
// production options must keep the same valid, >default-threshold SST in memory.
func TestProductionOptionsPreventSharedStringSpill(t *testing.T) {
	opts := workbookReadOptions()
	if opts.UnzipXMLSizeLimit != maxExpanded || opts.UnzipSizeLimit != maxExpanded {
		t.Fatal("XML threshold must equal total archive expansion limit")
	}
	input := fixture(t)
	z, err := zip.NewReader(bytes.NewReader(input), int64(len(input)))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	out := zip.NewWriter(&buf)
	for _, part := range z.File {
		r, err := part.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		if part.Name == "xl/sharedStrings.xml" {
			b = bytes.Replace(b, []byte("</sst>"), []byte("<!--"+strings.Repeat("x", 17<<20)+"--></sst>"), 1)
		}
		w, err := out.Create(part.Name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	if err = out.Close(); err != nil {
		t.Fatal(err)
	}
	if err = validateArchive(buf.Bytes()); err != nil {
		t.Fatal(err)
	}
	for _, spill := range []bool{true, false} {
		t.Run(fmt.Sprint("spill_control=", spill), func(t *testing.T) {
			o := opts
			o.TmpDir = t.TempDir()
			if spill {
				o.UnzipXMLSizeLimit = 1024
			}
			f, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()), o)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			value, err := f.GetCellValue("Sheet1", "A1")
			if err != nil || value != "Region" {
				t.Fatalf("value=%q err=%v", value, err)
			}
			files, err := os.ReadDir(o.TmpDir)
			if err != nil {
				t.Fatal(err)
			}
			if (len(files) > 0) != spill {
				t.Fatalf("unexpected temporary files: %d", len(files))
			}
		})
	}
}
