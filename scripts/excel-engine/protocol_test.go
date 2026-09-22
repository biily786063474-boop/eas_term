package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestOneShotProtocol(t *testing.T) {
	b, _ := json.Marshal(Request{Operation: "calculate", Workbook: fixture(t), Sheet: "Sheet1", Cell: "D1"})
	var out bytes.Buffer
	if e := Run(bytes.NewReader(b), &out); e != nil {
		t.Fatal(e)
	}
	var r Response
	if e := json.Unmarshal(out.Bytes(), &r); e != nil || r.Value != "30" {
		t.Fatalf("bad response %s %v", out.String(), e)
	}
	for _, input := range []string{`{"operation":"calculate","path":"/etc/passwd"}`, `{} {}`, `{"operation":"chart","chart":{"url":"https://evil.test"}}`} {
		if e := Run(strings.NewReader(input), &bytes.Buffer{}); e == nil {
			t.Fatal("invalid protocol accepted")
		}
	}
}
