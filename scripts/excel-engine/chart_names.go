package engine

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"
)

// Excelize serializes Name as a strRef formula. Our API defines Name as literal
// display text. Patch only the newly created chart's series tx elements, keeping
// all other XML bytes and existing package entries intact.
func literalChartNames(before, after []byte, c *ChartSpec) ([]byte, error) {
	old, e := zip.NewReader(bytes.NewReader(before), int64(len(before)))
	if e != nil {
		return nil, e
	}
	names := map[string]bool{}
	for _, p := range old.File {
		names[p.Name] = true
	}
	series := c.Series
	if len(series) == 0 {
		series = []ChartSeries{{c.Name, c.Categories, c.Values}}
	}
	z, e := zip.NewReader(bytes.NewReader(after), int64(len(after)))
	if e != nil {
		return nil, e
	}
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	found := 0
	for _, p := range z.File {
		if names[p.Name] || !strings.HasPrefix(p.Name, "xl/charts/chart") || !strings.HasSuffix(p.Name, ".xml") {
			if e = w.Copy(p); e != nil {
				return nil, e
			}
			continue
		}
		found++
		rc, e := p.Open()
		if e != nil {
			return nil, e
		}
		data, e := io.ReadAll(io.LimitReader(rc, maxExpanded+1))
		rc.Close()
		if e != nil || len(data) > maxExpanded {
			return nil, errors.New("chart XML exceeds bounds")
		}
		data, e = literalSeriesXML(data, series)
		if e != nil {
			return nil, e
		}
		header := p.FileHeader
		dst, e := w.CreateHeader(&header)
		if e != nil {
			return nil, e
		}
		if _, e = dst.Write(data); e != nil {
			return nil, e
		}
	}
	if found != 1 {
		return nil, errors.New("new chart identity is ambiguous")
	}
	if e = w.Close(); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}
func literalSeriesXML(data []byte, series []ChartSeries) ([]byte, error) {
	d := xml.NewDecoder(bytes.NewReader(data))
	var out bytes.Buffer
	stack := []string{}
	last, start, index := 0, -1, 0
	prefix := ""
	for {
		offset := int(d.InputOffset())
		token, e := d.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		switch t := token.(type) {
		case xml.StartElement:
			if t.Name.Local == "tx" && len(stack) > 0 && stack[len(stack)-1] == "ser" {
				if index >= len(series) {
					return nil, errors.New("unexpected chart series")
				}
				start = offset
				raw := string(data[offset:int(d.InputOffset())])
				if colon := strings.Index(raw, ":"); colon > 0 && colon < strings.Index(raw, ">") {
					prefix = raw[1:colon] + ":"
				} else {
					prefix = ""
				}
			}
			stack = append(stack, t.Name.Local)
		case xml.EndElement:
			if t.Name.Local == "tx" && start >= 0 {
				out.Write(data[last:start])
				out.WriteString("<" + prefix + "tx><" + prefix + "v>")
				if e = xml.EscapeText(&out, []byte(series[index].Name)); e != nil {
					return nil, e
				}
				out.WriteString("</" + prefix + "v></" + prefix + "tx>")
				last = int(d.InputOffset())
				start = -1
				index++
			}
			stack = stack[:len(stack)-1]
		}
	}
	if index != len(series) {
		return nil, errors.New("chart series names missing")
	}
	out.Write(data[last:])
	return out.Bytes(), nil
}
