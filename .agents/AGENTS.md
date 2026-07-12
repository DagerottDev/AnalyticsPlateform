# Frontend Error Handling Rule

Whenever developing new frontend features, hooking up APIs, or catching errors:
1. DO NOT truncate or selectively pick out just the `error.message` or `axiosError.response.data.detail`.
2. ALWAYS store the full raw `unknown` error object in the state.
3. ALWAYS display errors to the user using the `<ApiErrorDisplay error={error} />` component from `@/components/ui/ApiErrorDisplay` to ensure no details (like full tracebacks, 422 validation errors, or network issues) are swallowed, and to give the user a simple "Copy Error" button.
