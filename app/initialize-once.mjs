// Cache initialization, never user data. Concurrent requests share the same work;
// failures clear the promise so the next request can recover.
export function initializeOnce(initialize) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(initialize).catch(error => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
