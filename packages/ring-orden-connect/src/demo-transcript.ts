export type DemoTranscriptLine = { id: string; speaker: 'user' | 'agent'; text: string };
export function providerTranscript(event: { source: string; message: string; event_id: number; response_id?: string }): DemoTranscriptLine | null {
  if (!['user', 'ai'].includes(event.source) || !event.message.trim()) return null;
  const speaker = event.source === 'user' ? 'user' : 'agent';
  return { id: `${speaker}:${event.response_id ?? event.event_id}`, speaker, text: event.message.trim().slice(0, 10000) };
}
export function appendDemoTranscript(lines: DemoTranscriptLine[], next: DemoTranscriptLine): DemoTranscriptLine[] {
  const index = lines.findIndex(line => line.id === next.id);
  if (index >= 0) return lines.map((line, i) => i === index ? next : line);
  return [...lines, next].slice(-100);
}
