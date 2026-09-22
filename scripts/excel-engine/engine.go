// Package engine operates on in-memory XLSX only. Filesystem grants and optimistic
// writes remain the responsibility of the existing plugin file adapter.
package engine

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

const maxWorkbook = 8 << 20
const maxExpanded = 32 << 20

var cellPattern = regexp.MustCompile(`^[A-Z]{1,3}[1-9][0-9]{0,4}$`)
var forbiddenFormula = regexp.MustCompile(`(?i)(WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER\.ID|IMPORTXML|IMPORTDATA)\s*\(`)

type Request struct {
	Sheets    []SheetData `json:"sheets,omitempty"`
	Operation string      `json:"operation"`
	Workbook  []byte      `json:"workbook"`
	Sheet     string      `json:"sheet,omitempty"`
	Cell      string      `json:"cell,omitempty"`
	Changes   []Change    `json:"changes,omitempty"`
	Chart     *ChartSpec  `json:"chart,omitempty"`
	Pivot     *PivotSpec  `json:"pivot,omitempty"`
}
type Change struct {
	Cell    string      `json:"cell"`
	Value   interface{} `json:"value,omitempty"`
	Formula string      `json:"formula,omitempty"`
}
type ChartSpec struct {
	Type       string `json:"type"`
	Categories string `json:"categories"`
	Values     string `json:"values"`
	Name       string `json:"name"`
}
type PivotSpec struct {
	Source      string       `json:"source"`
	Destination string       `json:"destination"`
	Name        string       `json:"name"`
	Rows        []string     `json:"rows"`
	Columns     []string     `json:"columns,omitempty"`
	Data        []PivotValue `json:"data"`
}
type PivotValue struct {
	Field     string `json:"field"`
	Aggregate string `json:"aggregate"`
}
type Response struct {
	Sheets     []SheetData `json:"sheets,omitempty"`
	Calculated *bool       `json:"calculated,omitempty"`
	Workbook   []byte      `json:"workbook,omitempty"`
	Value      string      `json:"value,omitempty"`
	Note       string      `json:"note,omitempty"`
}

func cell(v string) error {
	if !cellPattern.MatchString(v) {
		return errors.New("invalid cell address")
	}
	c, r, e := excelize.CellNameToCoordinates(v)
	if e != nil || c > 1000 || r > 10000 {
		return errors.New("cell address exceeds bounds")
	}
	return nil
}
func formula(v string) error {
	if len(v) > 2048 || strings.ContainsAny(v, "[]|\x00\r\n") || forbiddenFormula.MatchString(v) {
		return errors.New("external or unsafe formula")
	}
	return nil
}
func sheet(f *excelize.File, s string) error {
	i, e := f.GetSheetIndex(s)
	if e != nil || i < 0 {
		return errors.New("sheet does not exist")
	}
	return nil
}
func reference(f *excelize.File, v string) error {
	i := strings.LastIndex(v, "!")
	if i < 1 || len(v) > 200 || strings.ContainsAny(v, "[]\x00") {
		return errors.New("range must reference a local sheet")
	}
	s := v[:i]
	if strings.HasPrefix(s, "'") && strings.HasSuffix(s, "'") {
		s = strings.ReplaceAll(s[1:len(s)-1], "''", "'")
	}
	if e := sheet(f, s); e != nil {
		return e
	}
	parts := strings.Split(strings.ReplaceAll(v[i+1:], "$", ""), ":")
	if len(parts) > 2 {
		return errors.New("invalid range")
	}
	for _, p := range parts {
		if e := cell(p); e != nil {
			return e
		}
	}
	if len(parts) == 2 {
		c1, r1, _ := excelize.CellNameToCoordinates(parts[0])
		c2, r2, _ := excelize.CellNameToCoordinates(parts[1])
		if c2 < c1 || r2 < r1 || (c2-c1+1)*(r2-r1+1) > 50000 {
			return errors.New("range exceeds bounds")
		}
	}
	return nil
}

// Preflight every entry before handing the archive to the workbook engine.
func validateArchive(b []byte) error {
	if len(b) == 0 || len(b) > maxWorkbook {
		return errors.New("XLSX exceeds 8MB")
	}
	z, e := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if e != nil {
		return errors.New("invalid XLSX ZIP")
	}
	if len(z.File) > 2000 {
		return errors.New("too many ZIP entries")
	}
	parts := map[string]bool{}
	for _, entry := range z.File {
		parts[entry.Name] = true
	}
	seen := map[string]bool{}
	total := int64(0)
	cells := 0
	for _, f := range z.File {
		n := f.Name
		lower := strings.ToLower(n)
		if seen[n] || strings.Contains(n, "\\") || strings.HasPrefix(n, "/") || path.Clean(n) != strings.TrimSuffix(n, "/") {
			return errors.New("unsafe or duplicate ZIP entry")
		}
		seen[n] = true
		for _, s := range []string{"vbaproject", "externallinks", "embeddings", "_xmlsignatures", "connections.xml", "activex"} {
			if strings.Contains(lower, s) {
				return errors.New("active or external workbook content")
			}
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > maxExpanded {
			return errors.New("ZIP expansion exceeds limit")
		}
		r, e := f.Open()
		if e != nil {
			return e
		}
		data, e := io.ReadAll(io.LimitReader(r, maxExpanded-total+1))
		r.Close()
		if e != nil {
			return e
		}
		total += int64(len(data))
		if total > maxExpanded {
			return errors.New("ZIP expansion exceeds limit")
		}
		if !strings.HasSuffix(lower, ".xml") && !strings.HasSuffix(lower, ".rels") {
			continue
		}
		d := xml.NewDecoder(bytes.NewReader(data))
		depth := 0
		inFormula := false
		var current strings.Builder
		for {
			tok, e := d.Token()
			if e == io.EOF {
				break
			}
			if e != nil {
				return errors.New("invalid workbook XML")
			}
			switch x := tok.(type) {
			case xml.Directive:
				return errors.New("XML directives forbidden")
			case xml.StartElement:
				depth++
				if depth > 100 {
					return errors.New("XML nesting exceeds limit")
				}
				attrs := map[string]string{}
				for _, a := range x.Attr {
					attrs[a.Name.Local] = a.Value
				}
				if x.Name.Local == "Relationship" {
					typ := strings.ToLower(attrs["Type"])
					target := attrs["Target"]
					if strings.EqualFold(attrs["TargetMode"], "External") || strings.Contains(target, ":") {
						return errors.New("external relationship forbidden")
					}
					// Leading slash denotes an OOXML package part, never an OS path.
					resolved := path.Clean(strings.TrimPrefix(target, "/"))
					if !strings.HasPrefix(target, "/") {
						resolved = path.Clean(path.Join(path.Dir(path.Dir(n)), target))
					}
					if strings.Contains(target, "\\") || strings.HasPrefix(resolved, "../") || !parts[resolved] {
						return errors.New("relationship target is not a package part")
					}
					for _, v := range []string{"vbaproject", "oleobject", "activex", "/package", "/control"} {
						if strings.HasSuffix(typ, v) {
							return errors.New("active relationship forbidden")
						}
					}
				}
				if strings.HasPrefix(lower, "xl/worksheets/") {
					if x.Name.Local == "row" {
						n, e := strconv.Atoi(attrs["r"])
						if e != nil || n < 1 || n > 10000 {
							return errors.New("row exceeds bounds")
						}
					}
					if x.Name.Local == "col" {
						for _, k := range []string{"min", "max"} {
							n, e := strconv.Atoi(attrs[k])
							if e != nil || n < 1 || n > 1000 {
								return errors.New("column exceeds bounds")
							}
						}
					}
					if x.Name.Local == "dimension" {
						for _, p := range strings.Split(attrs["ref"], ":") {
							if e := cell(p); e != nil {
								return e
							}
						}
					}
					if x.Name.Local == "c" {
						cells++
						if cells > 50000 {
							return errors.New("cell count exceeds limit")
						}
						if e := cell(attrs["r"]); e != nil {
							return e
						}
					}
					if x.Name.Local == "f" {
						inFormula = true
						current.Reset()
					}
				}
			case xml.CharData:
				if inFormula {
					current.Write(x)
					if current.Len() > 2048 {
						return errors.New("formula too long")
					}
				}
			case xml.EndElement:
				if inFormula && x.Name.Local == "f" {
					inFormula = false
					if e := formula(current.String()); e != nil {
						return e
					}
				}
				depth--
			}
		}
	}
	if !seen["xl/workbook.xml"] {
		return errors.New("missing workbook")
	}
	return nil
}
func Process(r Request) (Response, error) {
	if r.Operation == "create" {
		return create(r)
	}
	if r.Operation != "read" && r.Operation != "calculate" && r.Operation != "update" && r.Operation != "chart" && r.Operation != "pivot" {
		return Response{}, errors.New("unsupported operation")
	}
	if e := validateArchive(r.Workbook); e != nil {
		return Response{}, e
	}
	f, e := excelize.OpenReader(bytes.NewReader(r.Workbook), excelize.Options{UnzipSizeLimit: maxExpanded, UnzipXMLSizeLimit: maxExpanded, MaxCalcIterations: 1000})
	if e != nil {
		return Response{}, errors.New("cannot open workbook")
	}
	defer f.Close()
	if len(f.GetSheetList()) > 20 {
		return Response{}, errors.New("too many sheets")
	}
	if r.Operation == "read" {
		return read(f)
	}
	if r.Operation != "pivot" {
		if e := sheet(f, r.Sheet); e != nil {
			return Response{}, e
		}
	}
	switch r.Operation {
	case "calculate":
		if e := cell(r.Cell); e != nil {
			return Response{}, e
		}
		v, e := f.CalcCellValue(r.Sheet, r.Cell, excelize.Options{RawCellValue: true, MaxCalcIterations: 1000})
		if e != nil {
			return Response{}, fmt.Errorf("formula calculation failed: %s", v)
		}
		return Response{Value: v}, nil
	case "update":
		if len(r.Changes) == 0 || len(r.Changes) > 1000 {
			return Response{}, errors.New("invalid update count")
		}
		seen := map[string]bool{}
		for _, c := range r.Changes {
			if e := cell(c.Cell); e != nil {
				return Response{}, e
			}
			if seen[c.Cell] {
				return Response{}, errors.New("duplicate update")
			}
			seen[c.Cell] = true
			if c.Formula != "" {
				if c.Value != nil {
					return Response{}, errors.New("value and formula conflict")
				}
				if e := formula(c.Formula); e != nil {
					return Response{}, e
				}
				e = f.SetCellFormula(r.Sheet, c.Cell, c.Formula)
			} else {
				switch v := c.Value.(type) {
				case nil, bool:
				case string:
					if len(v) > 32767 {
						return Response{}, errors.New("cell text too long")
					}
				case float64:
					if math.IsNaN(v) || math.IsInf(v, 0) {
						return Response{}, errors.New("invalid number")
					}
				default:
					return Response{}, errors.New("invalid cell value")
				}
				e = f.SetCellValue(r.Sheet, c.Cell, c.Value)
			}
			if e != nil {
				return Response{}, e
			}
		}
	case "chart":
		if e := cell(r.Cell); e != nil {
			return Response{}, e
		}
		c := r.Chart
		if c == nil || len(c.Name) > 255 {
			return Response{}, errors.New("invalid chart")
		}
		types := map[string]excelize.ChartType{"column": excelize.Col, "bar": excelize.Bar, "line": excelize.Line, "pie": excelize.Pie, "scatter": excelize.Scatter}
		typ, ok := types[c.Type]
		if !ok {
			return Response{}, errors.New("unsupported chart type")
		}
		if e := reference(f, c.Categories); e != nil {
			return Response{}, e
		}
		if e := reference(f, c.Values); e != nil {
			return Response{}, e
		}
		e = f.AddChart(r.Sheet, r.Cell, &excelize.Chart{Type: typ, Series: []excelize.ChartSeries{{Name: c.Name, Categories: c.Categories, Values: c.Values}}})
	case "pivot":
		p := r.Pivot
		if p == nil || len(p.Name) == 0 || len(p.Name) > 255 || len(p.Rows) == 0 || len(p.Rows) > 20 || len(p.Columns) > 20 || len(p.Data) == 0 || len(p.Data) > 20 {
			return Response{}, errors.New("invalid pivot")
		}
		if e := reference(f, p.Source); e != nil {
			return Response{}, e
		}
		if e := reference(f, p.Destination); e != nil {
			return Response{}, e
		}
		o := &excelize.PivotTableOptions{DataRange: p.Source, PivotTableRange: p.Destination, Name: p.Name, RowGrandTotals: true, ColGrandTotals: true}
		for _, v := range p.Rows {
			o.Rows = append(o.Rows, excelize.PivotTableField{Data: v})
		}
		for _, v := range p.Columns {
			o.Columns = append(o.Columns, excelize.PivotTableField{Data: v})
		}
		for _, v := range p.Data {
			switch v.Aggregate {
			case "Sum", "Count", "Average", "Min", "Max":
			default:
				return Response{}, errors.New("unsupported aggregate")
			}
			o.Data = append(o.Data, excelize.PivotTableField{Data: v.Field, Subtotal: v.Aggregate})
		}
		e = f.AddPivotTable(o)
	}
	if e != nil {
		return Response{}, e
	}
	b, e := f.WriteToBuffer()
	if e != nil {
		return Response{}, errors.New("cannot encode workbook")
	}
	if e = validateArchive(b.Bytes()); e != nil {
		return Response{}, e
	}
	out := Response{Workbook: b.Bytes()}
	if r.Operation == "pivot" {
		out.Note = "原生透视表已写入；须由Excel打开刷新，未计算缓存汇总"
	}
	return out, nil
}
