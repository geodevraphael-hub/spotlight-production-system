// MShastra acknowledges submissions as: message ID, destination, Send Successful.
// HTTP 200 alone is not proof of acceptance, and acceptance is not delivery.
export function parseSmsAcknowledgement(status, text, recipient) {
  const rows = String(text).trim().split(/\r?\n/).filter(Boolean);
  const match = rows.length === 1 && rows[0].match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*Send Successful\s*$/i);
  const sent = status >= 200 && status < 300 && Boolean(match && match[2] === recipient);
  return {
    sent,
    provider: 'mshastra',
    providerId: sent ? match[1] : '',
    status,
    response: String(text).slice(0,1000),
    ...(sent ? {} : { error: String(text).trim().slice(0,1000) || `SMS provider returned HTTP ${status} without an acknowledgement`,
      ambiguous: status >= 200 && status < 300 && !/error|invalid|fail|not allowed|denied|unauthori[sz]ed|insufficient/i.test(text) }),
  };
}
