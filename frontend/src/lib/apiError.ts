interface AxiosLikeError {
  response?: { status: number; data?: unknown };
  request?: unknown;
  message?: string;
}

/**
 * Extracts a detailed, readable string from any error object,
 * ensuring no information is swallowed (e.g. backend tracebacks or validation errors).
 */
export function formatApiError(error: unknown): string {
  if (!error) return "";

  if (typeof error === "string") return error;

  const err = error as AxiosLikeError;
  let errorString = "";

  if (err.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    errorString += `Status: ${err.response.status}\n`;
    if (err.response.data) {
      errorString +=
        typeof err.response.data === "object"
          ? `Data: ${JSON.stringify(err.response.data, null, 2)}`
          : `Data: ${err.response.data}`;
    }
  } else if (err.request) {
    // The request was made but no response was received
    errorString += `Network Error: No response received. ${err.message || ""}`;
  } else {
    // Something happened in setting up the request that triggered an Error
    errorString += err.message || "Unknown error occurred";
  }

  return errorString;
}
