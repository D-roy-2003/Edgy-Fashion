import { NextRequest, NextResponse } from 'next/server'
import { pageRateLimiter, apiRateLimiter, getClientIP } from './lib/upstash-ratelimit'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Skip rate limiting if Upstash Redis is not configured (fail open)
  if (!pageRateLimiter || !apiRateLimiter) {
    return NextResponse.next()
  }

  // Get client IP
  const ip = getClientIP(request)

  // Check if it's an API route
  const isApiRoute = pathname.startsWith('/api/')

  try {
    if (isApiRoute) {
      // Rate limit API routes: 20 requests per minute
      const apiLimit = await apiRateLimiter.limit(ip)
      
      if (!apiLimit.success) {
        return NextResponse.json(
          { 
            error: 'Too many requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: apiLimit.reset
          },
          { 
            status: 429,
            headers: {
              'Retry-After': apiLimit.reset.toString(),
              'X-RateLimit-Limit': '20',
              'X-RateLimit-Remaining': apiLimit.remaining.toString(),
              'X-RateLimit-Reset': apiLimit.reset.toString(),
            }
          }
        )
      }

      // Add rate limit headers to successful API responses
      const response = NextResponse.next()
      response.headers.set('X-RateLimit-Limit', '20')
      response.headers.set('X-RateLimit-Remaining', apiLimit.remaining.toString())
      response.headers.set('X-RateLimit-Reset', apiLimit.reset.toString())
      return response
    } else {
      // Rate limit pages: 60 requests per minute
      const pageLimit = await pageRateLimiter.limit(ip)
      
      if (!pageLimit.success) {
        // Return HTML response for page routes
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Rate Limit Exceeded</title>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fff;">
              <div style="text-align: center; padding: 2rem;">
                <h1 style="font-size: 2rem; margin-bottom: 1rem;">429 - Too Many Requests</h1>
                <p style="font-size: 1.1rem; color: #999;">Rate limit exceeded. Please try again later.</p>
                <p style="font-size: 0.9rem; color: #666; margin-top: 1rem;">Retry after: ${new Date(pageLimit.reset * 1000).toLocaleTimeString()}</p>
              </div>
            </body>
          </html>
        `
        return new NextResponse(html, {
          status: 429,
          headers: {
            'Content-Type': 'text/html',
            'Retry-After': pageLimit.reset.toString(),
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': pageLimit.remaining.toString(),
            'X-RateLimit-Reset': pageLimit.reset.toString(),
          }
        })
      }

      // Add rate limit headers to successful page responses
      const response = NextResponse.next()
      response.headers.set('X-RateLimit-Limit', '60')
      response.headers.set('X-RateLimit-Remaining', pageLimit.remaining.toString())
      response.headers.set('X-RateLimit-Reset', pageLimit.reset.toString())
      return response
    }
  } catch (error) {
    // If rate limiting fails, fail open (allow request through)
    console.error('Rate limiting error:', error)
    return NextResponse.next()
  }
}

// Configure which routes to run middleware on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
