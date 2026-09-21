export type RecognitionServiceToken = {
  token: string;
  expiresAt: string;
};

export declare function issueRecognitionServiceToken(
  subject: string,
  nowMs?: number,
  ttlSeconds?: number,
): RecognitionServiceToken;
