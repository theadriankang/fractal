// "Weigh across domains" answers are stored as one response with this pseudo model id. The full
// structured result lives in response.auto.weigh (an existing JSON column, so no schema change);
// response.content holds the same result as Markdown, so copy and follow-up turns can read it.
export const WEIGH_ID = 'fractal-weigh'

export const isWeigh = (r) => r?.modelId === WEIGH_ID
