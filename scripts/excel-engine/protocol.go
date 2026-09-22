package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

// Run processes exactly one request. No paths, environment expansion or network
// destinations are part of this protocol. Errors produce no workbook output.
func Run(in io.Reader, out io.Writer) error {
	const limit = 12 << 20
	b, e := io.ReadAll(io.LimitReader(in, limit+1))
	if e != nil || len(b) > limit {
		return errors.New("request exceeds 12MB")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	var r Request
	if e = d.Decode(&r); e != nil {
		return errors.New("invalid engine request")
	}
	var extra interface{}
	if d.Decode(&extra) != io.EOF {
		return errors.New("multiple engine requests forbidden")
	}
	result, e := Process(r)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(result)
}
