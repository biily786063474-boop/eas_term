package engine

import (
	"encoding/json"
	"errors"
	"github.com/xuri/excelize/v2"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

type SheetData struct {
	Name string          `json:"name"`
	Rows [][]interface{} `json:"rows"`
}

func create(r Request) (Response, error) {
	if len(r.Workbook) != 0 || len(r.Sheets) < 1 || len(r.Sheets) > 20 {
		return Response{}, errors.New("invalid create request")
	}
	f := excelize.NewFile()
	defer f.Close()
	seen := map[string]bool{}
	count := 0
	for i, s := range r.Sheets {
		name := strings.ToLower(s.Name)
		if strings.TrimSpace(s.Name) == "" || utf8.RuneCountInString(s.Name) > 31 || strings.ContainsAny(s.Name, "[]:*?/\\\x00\r\n") || strings.HasPrefix(s.Name, "'") || strings.HasSuffix(s.Name, "'") || seen[name] || len(s.Rows) > 10000 {
			return Response{}, errors.New("invalid sheet")
		}
		seen[name] = true
		if i == 0 {
			if e := f.SetSheetName("Sheet1", s.Name); e != nil {
				return Response{}, e
			}
		} else {
			if _, e := f.NewSheet(s.Name); e != nil {
				return Response{}, e
			}
		}
		for ri, row := range s.Rows {
			count += len(row)
			if len(row) > 1000 || count > 50000 {
				return Response{}, errors.New("too many cells")
			}
			for ci, v := range row {
				a, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
				if m, ok := v.(map[string]interface{}); ok {
					text, ok := m["formula"].(string)
					if !ok || text == "" || len(m) != 1 {
						return Response{}, errors.New("invalid formula cell")
					}
					if e := formula(text); e != nil {
						return Response{}, e
					}
					if e := f.SetCellFormula(s.Name, a, text); e != nil {
						return Response{}, e
					}
				} else {
					if e := scalar(v); e != nil {
						return Response{}, e
					}
					if e := f.SetCellValue(s.Name, a, v); e != nil {
						return Response{}, e
					}
				}
			}
		}
	}
	b, e := f.WriteToBuffer()
	if e != nil {
		return Response{}, e
	}
	if e = validateArchive(b.Bytes()); e != nil {
		return Response{}, e
	}
	return Response{Workbook: b.Bytes()}, nil
}
func scalar(v interface{}) error {
	switch x := v.(type) {
	case nil, bool:
		return nil
	case string:
		if utf8.RuneCountInString(x) <= 32767 && !strings.ContainsRune(x, 0) {
			return nil
		}
	case float64:
		if !math.IsNaN(x) && !math.IsInf(x, 0) {
			return nil
		}
	}
	return errors.New("invalid cell value")
}
func read(f *excelize.File) (Response, error) {
	result := Response{Sheets: []SheetData{}, Note: "只读取公式及已有缓存，不执行计算；日期数值保留原始序列值，不代表完整图表/透视/排版还原"}
	no := false
	result.Calculated = &no
	count := 0
	for _, s := range f.GetSheetList() {
		rows, e := f.GetRows(s, excelize.Options{RawCellValue: true})
		if e != nil {
			return Response{}, e
		}
		if len(rows) > 10000 {
			return Response{}, errors.New("too many rows")
		}
		data := SheetData{Name: s, Rows: make([][]interface{}, len(rows))}
		for ri, row := range rows {
			count += len(row)
			if len(row) > 1000 || count > 50000 {
				return Response{}, errors.New("too many cells")
			}
			data.Rows[ri] = make([]interface{}, len(row))
			for ci, raw := range row {
				a, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
				typ, e := f.GetCellType(s, a)
				if e != nil {
					return Response{}, e
				}
				var v interface{} = raw
				switch typ {
				case excelize.CellTypeBool:
					v = raw == "1" || raw == "TRUE"
				case excelize.CellTypeError:
					v = map[string]interface{}{"error": raw}
				case excelize.CellTypeDate:
					v = map[string]interface{}{"date": raw}
				case excelize.CellTypeUnset, excelize.CellTypeNumber:
					if raw == "" {
						v = nil
					} else if n, e := strconv.ParseFloat(raw, 64); e == nil && !math.IsInf(n, 0) && !math.IsNaN(n) {
						v = n
					}
				}
				form, e := f.GetCellFormula(s, a)
				if e != nil {
					return Response{}, e
				}
				if form != "" {
					m := map[string]interface{}{"formula": form}
					if raw != "" {
						m["cachedResult"] = v
					}
					v = m
				}
				data.Rows[ri][ci] = v
			}
		}
		result.Sheets = append(result.Sheets, data)
	}
	b, e := json.Marshal(result)
	if e != nil || len(b) > 4<<20 {
		return Response{}, errors.New("read result exceeds 4MB")
	}
	return result, nil
}
