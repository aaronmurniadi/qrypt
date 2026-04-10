package backend

import (
	"bytes"
	"testing"
)

func TestMimeForPath(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"test.png", "image/png"},
		{"test.jpg", "image/jpeg"},
		{"test.txt", "text/plain; charset=utf-8"},
		{"test.unknown", "application/octet-stream"},
		{"noextension", "application/octet-stream"},
		{"path/to/file.mp4", "video/mp4"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			actual := mimeForPath(tt.path)
			if actual != tt.expected {
				t.Errorf("mimeForPath(%q) = %q; want %q", tt.path, actual, tt.expected)
			}
		})
	}
}

func TestPkcs7PadUnpad(t *testing.T) {
	data := []byte("hello world")
	padded := pkcs7Pad(data, 16)
	if len(padded) != 16 {
		t.Errorf("expected padded length 16, got %d", len(padded))
	}
	
	unpadded, err := pkcs7Unpad(padded)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Equal(unpadded, data) {
		t.Errorf("expected %q, got %q", data, unpadded)
	}
}
