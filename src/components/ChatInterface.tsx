import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export interface ChatInterfaceHandle {
  focusInput: () => void;
}

const ChatInterface = forwardRef<ChatInterfaceHandle>((props, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputMeasureRef = useRef<HTMLSpanElement>(null);
  const [cursorLeft, setCursorLeft] = useState(0);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    // Auto-focus the input on mount
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Refocus input after messages change (especially after assistant responds)
    inputRef.current?.focus();
  }, [messages]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Update cursor position based on input value
    if (inputMeasureRef.current) {
      setCursorLeft(inputMeasureRef.current.offsetWidth);
    }
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response },
      ]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'ERROR: Backend not running. Start server: vercel dev',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      className="chat-interface"
      onClick={handleClick}
      role="button"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <div className="chat-messages">
        {messages.map((msg, index) => (
          // eslint-disable-next-line react/no-array-index-key
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
          <span ref={inputMeasureRef} className="input-measure">
            {input}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="chat-input"
            disabled={isLoading}
            autoComplete="off"
            spellCheck="false"
          />
          <span className="cursor-blink" style={{ left: `${cursorLeft}px` }}>
            _
          </span>
        </div>
      </form>
    </div>
  );
});

ChatInterface.displayName = 'ChatInterface';

export default ChatInterface;
