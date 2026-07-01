import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  debounce,
  isEventRelevantToUser,
  toastForEvent,
  topicsForEvent,
} from "@/lib/realtimeEvents";

const RealtimeEventsContext = createContext(null);

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const FALLBACK_POLL_MS = 30000;

function parseSseChunk(buffer) {
  const events = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const part of parts) {
    const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice(6)));
    } catch {
      /* ignore malformed */
    }
  }
  return { events, rest };
}

export function RealtimeEventsProvider({ children }) {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState("idle");
  const invalidatorsRef = useRef(new Map());
  const activeTopicsRef = useRef(new Set());
  const abortRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const pollTimerRef = useRef(null);

  const runInvalidators = useCallback((topics) => {
    const seen = new Set();
    topics.forEach((topic) => {
      const fns = invalidatorsRef.current.get(topic);
      if (!fns) return;
      fns.forEach((fn) => {
        const key = `${topic}:${fn}`;
        if (seen.has(key)) return;
        seen.add(key);
        try {
          fn();
        } catch {
          /* page handler errors should not break stream */
        }
      });
    });
  }, []);

  const debouncedInvalidate = useMemo(
    () => debounce((topics) => runInvalidators(topics), 750),
    [runInvalidators],
  );

  const handleEvent = useCallback((event) => {
    if (!user || !event) return;
    if (!isEventRelevantToUser(event, user)) return;
    const topics = topicsForEvent(event);
    if (!topics.length) return;
    debouncedInvalidate(topics);
    const toastPayload = toastForEvent(event, user);
    if (toastPayload?.message) {
      if (toastPayload.level === "success") toast.success(toastPayload.message);
      else toast.message(toastPayload.message);
    }
  }, [user, debouncedInvalidate]);

  const registerInvalidator = useCallback((topic, fn) => {
    if (!topic || typeof fn !== "function") return () => {};
    const map = invalidatorsRef.current;
    if (!map.has(topic)) map.set(topic, new Set());
    map.get(topic).add(fn);
    activeTopicsRef.current.add(topic);
    return () => {
      map.get(topic)?.delete(fn);
      if (map.get(topic)?.size === 0) {
        map.delete(topic);
        activeTopicsRef.current.delete(topic);
      }
    };
  }, []);

  const pollActiveTopics = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    const topics = [...activeTopicsRef.current];
    if (topics.length) runInvalidators(topics);
  }, [runInvalidators]);

  const startFallbackPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(pollActiveTopics, FALLBACK_POLL_MS);
  }, [pollActiveTopics]);

  const stopFallbackPolling = useCallback(() => {
    if (!pollTimerRef.current) return;
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const connectStream = useCallback(async () => {
    const token = localStorage.getItem("bl_token");
    if (!token || !user?.clinic_id || user?.platform_admin) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    try {
      const response = await fetch(`${API_BASE}/api/realtime/events`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok || !response.body) {
        throw new Error(`stream ${response.status}`);
      }

      reconnectAttemptRef.current = 0;
      setStatus("connected");
      stopFallbackPolling();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        parsed.events.forEach(handleEvent);
      }

      throw new Error("stream closed");
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus("polling");
      startFallbackPolling();
      reconnectAttemptRef.current += 1;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * (2 ** Math.min(reconnectAttemptRef.current, 4)),
      );
      setTimeout(() => {
        if (!controller.signal.aborted) connectStream();
      }, delay);
    }
  }, [user, handleEvent, startFallbackPolling, stopFallbackPolling]);

  useEffect(() => {
    if (loading) return undefined;
    if (!user?.clinic_id || user?.platform_admin) {
      setStatus("idle");
      abortRef.current?.abort();
      stopFallbackPolling();
      return undefined;
    }

    connectStream();
    const onVisibility = () => {
      if (document.visibilityState === "visible") pollActiveTopics();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      abortRef.current?.abort();
      stopFallbackPolling();
      debouncedInvalidate.cancel();
      document.removeEventListener("visibilitychange", onVisibility);
      setStatus("idle");
    };
  }, [
    user?.id,
    user?.clinic_id,
    user?.platform_admin,
    loading,
    connectStream,
    pollActiveTopics,
    stopFallbackPolling,
    debouncedInvalidate,
  ]);

  const value = useMemo(
    () => ({
      status,
      registerInvalidator,
    }),
    [status, registerInvalidator],
  );

  return (
    <RealtimeEventsContext.Provider value={value}>
      {children}
    </RealtimeEventsContext.Provider>
  );
}

export function useRealtimeEvents() {
  return useContext(RealtimeEventsContext);
}

/** Register a refetch callback for a realtime topic; optional visibility polling when SSE is down. */
export function useRealtimeInvalidation(topic, callback, enabled = true) {
  const ctx = useRealtimeEvents();

  useEffect(() => {
    if (!enabled || !topic || !callback || !ctx?.registerInvalidator) return undefined;
    return ctx.registerInvalidator(topic, callback);
  }, [topic, callback, enabled, ctx]);
}

export function useVisibilityPolling(callback, intervalMs = FALLBACK_POLL_MS, enabled = true) {
  const ctx = useRealtimeEvents();
  const sseConnected = ctx?.status === "connected";
  const shouldPoll = enabled && !sseConnected;

  useEffect(() => {
    if (!shouldPoll || !callback) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") callback();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") callback();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [callback, intervalMs, shouldPoll]);
}
