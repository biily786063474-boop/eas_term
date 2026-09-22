package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestCreateReadRoundtrip(t *testing.T) {
	var out bytes.Buffer
	input := `{"operation":"create","sheets":[{"name":"数据","rows":[["=literal",12,true,null,{"formula":"SUM(B1:B2)"}],["中文",8]]}]}`
	if e := Run(strings.NewReader(input), &out); e != nil {
		t.Fatal(e)
	}
	var created Response
	if e := json.Unmarshal(out.Bytes(), &created); e != nil {
		t.Fatal(e)
	}
	read, e := Process(Request{Operation: "read", Workbook: created.Workbook})
	if e != nil {
		t.Fatal(e)
	}
	if len(read.Sheets) != 1 || read.Sheets[0].Name != "数据" {
		t.Fatalf("%+v", read)
	}
	row := read.Sheets[0].Rows[0]
	if row[0] != "=literal" || row[1] != float64(12) || row[2] != true || row[3] != nil {
		t.Fatalf("%+v", row)
	}
	if row[4].(map[string]interface{})["formula"] != "SUM(B1:B2)" {
		t.Fatalf("%+v", row[4])
	}
	result, e := Process(Request{Operation: "calculate", Workbook: created.Workbook, Sheet: "数据", Cell: "E1"})
	if e != nil || result.Value != "20" {
		t.Fatalf("%+v %v", result, e)
	}
}
func TestCreateRejectsUnsafeOrAmbiguousData(t *testing.T) {
	for _, s := range []string{
		`[]`, `[{"name":"x","rows":[[{"formula":"1","other":true}]]}]`,
		`[{"name":"x","rows":[[{"formula":"WEBSERVICE(\"https://evil.test\")"}]]}]`,
		`[{"name":"x","rows":[]},{"name":"X","rows":[]}]`,
		`[{"name":"bad/name","rows":[]}]`,
	} {
		if e := Run(strings.NewReader(`{"operation":"create","sheets":`+s+`}`), &bytes.Buffer{}); e == nil {
			t.Fatal("accepted " + s)
		}
	}
}
func TestReadAnalyticsWithoutRewriting(t *testing.T) {
	b := fixture(t)
	r, e := Process(Request{Operation: "chart", Workbook: b, Sheet: "Sheet1", Cell: "F2", Chart: &ChartSpec{Type: "column", Categories: "Sheet1!A2:A3", Values: "Sheet1!B2:B3"}})
	if e != nil {
		t.Fatal(e)
	}
	read, e := Process(Request{Operation: "read", Workbook: r.Workbook})
	if e != nil || len(read.Sheets) != 1 || len(read.Workbook) != 0 {
		t.Fatalf("%+v %v", read, e)
	}
}
