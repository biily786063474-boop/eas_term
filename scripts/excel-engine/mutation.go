package engine

import (
	"errors"
	"github.com/xuri/excelize/v2"
	"strings"
)

type ChartSeries struct {
	Name       string `json:"name"`
	Categories string `json:"categories"`
	Values     string `json:"values"`
}
type rect struct {
	s              string
	x1, y1, x2, y2 int
}

func parseRect(f *excelize.File, v string) (rect, error) {
	if e := reference(f, v); e != nil {
		return rect{}, e
	}
	i := strings.LastIndex(v, "!")
	s := v[:i]
	if strings.HasPrefix(s, "'") {
		s = strings.ReplaceAll(s[1:len(s)-1], "''", "'")
	}
	p := strings.Split(strings.ReplaceAll(v[i+1:], "$", ""), ":")
	x, y, _ := excelize.CellNameToCoordinates(p[0])
	r := rect{s, x, y, x, y}
	if len(p) == 2 {
		r.x2, r.y2, _ = excelize.CellNameToCoordinates(p[1])
	}
	return r, nil
}
func overlap(a, b rect) bool {
	return strings.EqualFold(a.s, b.s) && a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
}
func rejectMerged(f *excelize.File, r rect) error {
	merges, e := f.GetMergeCells(r.s, true)
	if e != nil {
		return e
	}
	for _, m := range merges {
		x1, y1, _ := excelize.CellNameToCoordinates(m.GetStartAxis())
		x2, y2, _ := excelize.CellNameToCoordinates(m.GetEndAxis())
		if overlap(r, rect{r.s, x1, y1, x2, y2}) {
			return errors.New("merged cell editing is not supported")
		}
	}
	return nil
}
func chartSeries(f *excelize.File, c *ChartSpec) ([]excelize.ChartSeries, error) {
	series := c.Series
	if len(series) == 0 {
		series = []ChartSeries{{c.Name, c.Categories, c.Values}}
	} else if c.Name != "" || c.Categories != "" || c.Values != "" {
		return nil, errors.New("conflicting chart series")
	}
	if len(series) > 20 || (c.Type == "pie" && len(series) != 1) {
		return nil, errors.New("invalid chart series count")
	}
	out := []excelize.ChartSeries{}
	for _, s := range series {
		if len(s.Name) > 255 {
			return nil, errors.New("chart name too long")
		}
		a, e := parseRect(f, s.Categories)
		if e != nil {
			return nil, e
		}
		b, e := parseRect(f, s.Values)
		if e != nil {
			return nil, e
		}
		if (a.x1 != a.x2 && a.y1 != a.y2) || (b.x1 != b.x2 && b.y1 != b.y2) || (a.x2-a.x1+1)*(a.y2-a.y1+1) != (b.x2-b.x1+1)*(b.y2-b.y1+1) {
			return nil, errors.New("chart ranges must be equal length vectors")
		}
		out = append(out, excelize.ChartSeries{Name: s.Name, Categories: s.Categories, Values: s.Values})
	}
	return out, nil
}
func pivotDestination(f *excelize.File, p *PivotSpec) error {
	source, e := parseRect(f, p.Source)
	if e != nil {
		return e
	}
	dest, e := parseRect(f, p.Destination)
	if e != nil {
		return e
	}
	if overlap(source, dest) {
		return errors.New("pivot destination overlaps source")
	}
	if e = rejectMerged(f, dest); e != nil {
		return e
	}
	pivots, e := f.GetPivotTables(dest.s)
	if e != nil {
		return e
	}
	for _, existing := range pivots {
		r, e := parseRect(f, existing.PivotTableRange)
		if e != nil {
			return e
		}
		if overlap(dest, r) {
			return errors.New("pivot destination overlaps existing pivot")
		}
	}
	tables, e := f.GetTables(dest.s)
	if e != nil {
		return e
	}
	for _, table := range tables {
		r, e := parseRect(f, "'"+strings.ReplaceAll(dest.s, "'", "''")+"'!"+table.Range)
		if e != nil {
			return e
		}
		if overlap(dest, r) {
			return errors.New("pivot destination overlaps table")
		}
	}
	for y := dest.y1; y <= dest.y2; y++ {
		for x := dest.x1; x <= dest.x2; x++ {
			a, _ := excelize.CoordinatesToCellName(x, y)
			v, e := f.GetCellValue(dest.s, a, excelize.Options{RawCellValue: true})
			if e != nil {
				return e
			}
			form, e := f.GetCellFormula(dest.s, a)
			if e != nil {
				return e
			}
			if v != "" || form != "" {
				return errors.New("pivot destination contains data")
			}
		}
	}
	return nil
}
