package storage

// DeviceStateChanges is an invalidation signal, not an event queue. A subscriber
// takes the signal before reading its snapshot, so concurrent commits are not lost.
// Slow readers coalesce changes and never block ingestion.
func (s *Store) DeviceStateChanges() <-chan struct{} {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.stateChanged == nil {
		s.stateChanged = make(chan struct{})
	}
	return s.stateChanged
}
func (s *Store) notifyDeviceStates() {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.stateChanged != nil {
		close(s.stateChanged)
	}
	s.stateChanged = make(chan struct{})
}
