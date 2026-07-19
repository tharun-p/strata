package credentials

import (
	"errors"
	"fmt"
	"sync"

	"github.com/zalando/go-keyring"
)

const databasePasswordPurpose = "database_password"

var ErrNotFound = errors.New("credential was not found")

// Store deliberately exposes opaque owner IDs instead of connection details.
// This keeps profile renames and host changes independent from credential-vault
// item identity and gives future auth mechanisms their own purpose namespace.
type Store interface {
	Set(ownerID, purpose, secret string) error
	Get(ownerID, purpose string) (string, error)
	Delete(ownerID, purpose string) error
}

type OSStore struct {
	service string
}

func NewOSStore(service string) *OSStore {
	return &OSStore{service: service}
}

func DatabasePasswordPurpose() string { return databasePasswordPurpose }

func account(ownerID, purpose string) string {
	return ownerID + ":" + purpose
}

func (s *OSStore) Set(ownerID, purpose, secret string) error {
	if err := keyring.Set(s.service, account(ownerID, purpose), secret); err != nil {
		return fmt.Errorf("store credential in the operating-system vault: %w", err)
	}
	return nil
}

func (s *OSStore) Get(ownerID, purpose string) (string, error) {
	secret, err := keyring.Get(s.service, account(ownerID, purpose))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read credential from the operating-system vault: %w", err)
	}
	return secret, nil
}

func (s *OSStore) Delete(ownerID, purpose string) error {
	err := keyring.Delete(s.service, account(ownerID, purpose))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete credential from the operating-system vault: %w", err)
	}
	return nil
}

// MemoryStore is used by unit tests and other environments where invoking the
// user's real credential vault would be unsafe.
type MemoryStore struct {
	mu      sync.RWMutex
	secrets map[string]string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{secrets: make(map[string]string)}
}

func (s *MemoryStore) Set(ownerID, purpose, secret string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.secrets[account(ownerID, purpose)] = secret
	return nil
}

func (s *MemoryStore) Get(ownerID, purpose string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	secret, ok := s.secrets[account(ownerID, purpose)]
	if !ok {
		return "", ErrNotFound
	}
	return secret, nil
}

func (s *MemoryStore) Delete(ownerID, purpose string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.secrets, account(ownerID, purpose))
	return nil
}
