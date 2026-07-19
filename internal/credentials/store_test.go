package credentials

import (
	"errors"
	"testing"
)

func TestMemoryStoreSeparatesOwnersAndPurposes(t *testing.T) {
	store := NewMemoryStore()
	if err := store.Set("profile-a", DatabasePasswordPurpose(), "one"); err != nil {
		t.Fatal(err)
	}
	if err := store.Set("profile-b", DatabasePasswordPurpose(), "two"); err != nil {
		t.Fatal(err)
	}
	secret, err := store.Get("profile-a", DatabasePasswordPurpose())
	if err != nil || secret != "one" {
		t.Fatalf("unexpected secret result: %q, %v", secret, err)
	}
	if err := store.Delete("profile-a", DatabasePasswordPurpose()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("profile-a", DatabasePasswordPurpose()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}
