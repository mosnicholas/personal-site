import { useEffect, useRef, useState, type FormEvent } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  /** Error notices are shown in the terminal but never sent to the model */
  isError?: boolean;
};

// Matches MAX_HISTORY_MESSAGES in api/chat.ts
const MAX_HISTORY_MESSAGES = 20;

const ERROR_MESSAGE = import.meta.env.DEV
  ? 'ERROR: Backend not reachable. Run `npm start` (vercel dev) for the API.'
  : 'ERROR: Connection lost. Try again in a moment.';
const RATE_LIMIT_MESSAGE = 'ERROR: Too many messages. Try again in a minute.';

/**
 * The conversation the model sees: skips error notices and the messages that
 * got them, so a failed send doesn't linger in the context.
 */
const toHistory = (messages: Message[]) =>
  messages
    .filter((msg, i) => !msg.isError && !messages[i + 1]?.isError)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(({ role, content }) => ({ role, content }));

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Focus on mount and whenever a reply finishes (the input is disabled while loading)
  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    // Typing anywhere on the page goes to the prompt
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || isLoading) return;

    const userTurn: Message = { role: 'user', content: userMessage };
    const history = toHistory([...messages, userTurn]);

    setInput('');
    setMessages((prev) => [...prev, userTurn]);
    setIsLoading(true);

    const reply: Message = {
      role: 'assistant',
      content: ERROR_MESSAGE,
      isError: true,
    };
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      // Not every failure has a JSON body (e.g. a platform-level 429 or 5xx)
      const data: { response?: string; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (response.ok && data.response) {
        reply.content = data.response;
        reply.isError = false;
      } else if (data.error) {
        reply.content = `ERROR: ${data.error}`;
      } else if (response.status === 429) {
        reply.content = RATE_LIMIT_MESSAGE;
      }
    } catch (error) {
      console.error('Chat error:', error);
    }

    setMessages((prev) => [...prev, reply]);
    setIsLoading(false);
  };

  return (
    <div className="chat-interface">
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className="chat-message">
            <span className="message-prefix">
              {msg.role === 'user' ? '> ' : '< '}
            </span>
            <span className="message-content">{msg.content}</span>
          </div>
        ))}
        {isLoading && (
          <div className="chat-message">
            <span className="message-prefix">{'< '}</span>
            <span className="message-content typing-indicator">...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="chat-input-form">
        <span className="input-prefix">&gt; </span>
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="chat-input"
            disabled={isLoading}
            maxLength={500}
            autoComplete="off"
            spellCheck="false"
            aria-label="Message nimo's terminal"
          />
          {/* Monospace font, so the cursor sits `input.length` characters in */}
          <span className="cursor-blink" style={{ left: `${input.length}ch` }}>
            _
          </span>
        </div>
      </form>
    </div>
  );
};

export default ChatInterface;
