const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api'

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      throw new Error('Unauthorized')
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({
        error: 'Unknown error',
        code: 'UNKNOWN_ERROR',
      }))
      throw errorBody
    }

    return (await response.json()) as T
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.includes('fetch')
    ) {
      throw new Error(`Network error: unable to reach ${url}`)
    }
    throw error
  }
}
