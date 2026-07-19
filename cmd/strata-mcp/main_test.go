package main

import "testing"

func TestConnectionInputFromURL(t *testing.T) {
	input, err := connectionInputFromURL("postgresql://investigator:s3cret@db.example.com:6432/commerce?sslmode=require")
	if err != nil {
		t.Fatal(err)
	}
	if input.Host != "db.example.com" || input.Port != 6432 || input.Database != "commerce" || input.Username != "investigator" || input.Password != "s3cret" || input.SSLMode != "require" {
		t.Fatalf("unexpected connection input: %#v", input)
	}
}

func TestConnectionInputFromURLRejectsWrongScheme(t *testing.T) {
	if _, err := connectionInputFromURL("mysql://user:secret@localhost/app"); err == nil {
		t.Fatal("expected a scheme validation error")
	}
}
