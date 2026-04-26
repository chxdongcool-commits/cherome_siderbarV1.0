import './styles.css';

export function App() {
  return (
    <div className="app">
      <header className="header">
        <span className="header-title">OpenClaw</span>
      </header>
      <main className="messages">
        <div className="welcome">
          <p>Welcome to OpenClaw Sidebar</p>
          <p className="welcome-sub">Connecting...</p>
        </div>
      </main>
      <footer className="input-area">
        <textarea
          className="input-box"
          placeholder="Type a message..."
          rows={1}
          disabled
        />
        <button className="send-btn" disabled>Send</button>
      </footer>
    </div>
  );
}
