import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/splunk/test-connection
 * Test Splunk configuration without saving
 * Public endpoint - no auth required
 */
export async function POST(request: NextRequest) {
  try {
    const { url, hec_token, username, password, ssl_verify } = await request.json();

    if (!url || !hec_token) {
      return NextResponse.json(
        { error: 'URL and HEC token are required', success: false },
        { status: 400 }
      );
    }

    // Test HEC endpoint
    try {
      const testPayload = {
        event: 'test',
        source: 'datasensAI-test',
        sourcetype: '_json',
        time: Math.floor(Date.now() / 1000),
      };

      const response = await fetch(`${url}/services/collector`, {
        method: 'POST',
        headers: {
          'Authorization': `Splunk ${hec_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
        // @ts-ignore - Node.js fetch doesn't have these options in types, but they work
        ...(ssl_verify === false && {
          rejectUnauthorized: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          {
            success: false,
            message: `HEC test failed: ${response.status} ${response.statusText}`,
            details: errorText.substring(0, 200),
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Connection successful',
        details: {
          splunk_version: 'unknown',
        },
      });
    } catch (testError) {
      const errorMsg = testError instanceof Error ? testError.message : String(testError);

      if (errorMsg.includes('ECONNREFUSED')) {
        return NextResponse.json(
          {
            success: false,
            message: 'Connection refused. Ensure Splunk is running on the correct port (default 8089).',
            details: errorMsg,
          },
          { status: 400 }
        );
      }

      if (errorMsg.includes('ENOTFOUND')) {
        return NextResponse.json(
          {
            success: false,
            message: 'Splunk host not found. Check the URL and ensure DNS is configured.',
            details: errorMsg,
          },
          { status: 400 }
        );
      }

      if (errorMsg.includes('CERTIFICATE')) {
        return NextResponse.json(
          {
            success: false,
            message: 'SSL certificate validation failed. Try unchecking "Verify SSL Certificate".',
            details: errorMsg,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: 'Connection test failed',
          details: errorMsg,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Splunk test connection error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Test connection request failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
