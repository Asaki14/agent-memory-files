const SECRET = /password|passwd|secret|api[_ -]?key|access[_ -]?token|authorization|cookie|密码|口令|密钥|令牌|[?&](?:token|key|auth)=|https?:\/\/[^\s/]+@/i;

/** Credential-bearing text is never sent to extraction or review, and never stored. */
export function hasSecret(text: string): boolean {
	return SECRET.test(text);
}
