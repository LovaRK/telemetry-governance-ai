import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

export async function POST(request: NextRequest) {
  try {
    const { url, apiUrl, hecUrl, hec_token, username, password, ssl_verify } = await request.json();
    const resolvedHecUrl = (hecUrl || url || '').replace(/\/$/, '');
    const resolvedApiUrl = (apiUrl || url || '').replace(/\/$/, '');
    const sslVerify = ssl_verify !== false;

    if (!resolvedHecUrl || !hec_token) {
      return NextResponse.json(
        { error: 'URL and HEC token are required', success: false },
        { status: 400 }
      );
    }

    const agent = new https.Agent({ rejectUnauthorized: sslVerify });

    // Test HEC endpoint
    const hecResponse = await fetch(`${resolvedHecUrl}/services/collector`, {
      method: 'POST',
      headers: {
        Authorization: `Splunk ${hec_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: { message: 'Test event from Dashboard' },
        sourcetype: '_json',
      }),
      agent,
    });

    if (hecResponse.status !== 200) {
      const text = await hecResponse.text();
      if (hecResponse.status === 401) {
        return NextResponse.json({
          success: false,
          message: 'HEC test failed: 401 Unauthorized',
          details: text,
        });
      }
      return NextResponse.json({
        success: false,
        message: `HEC test failed: HTTP ${hecResponse.status}`,
        details: text,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'HEC endpoint is healthy',
      details: { splunk_version: 'unknown', hec_status: 'healthy' },
    });
  } catch (error: any) {
    const msg = error.message || 'Unknown error';
    if (msg.includes('ECONNREFUSED')) {
      return NextResponse.json({
        success: false,
        message: 'HEC connection refused. Ensure Splunk HEC is enabled and port is correct (default 8088).',
        details: msg,
      });
    }
    if (msg.includes('ENOTFOUND')) {
      return NextResponse.json({
        success: false,
        message: 'Splunk host not found. Check the URL and ensure DNS is configured.',
        details: msg,
      });
    }
    if (msg.includes('CERTIFICATE') || msg.includes('certificate')) {
      return NextResponse.json({
        success: false,
        message: 'SSL certificate validation failed. Try unchecking "Verify SSL Certificate".',
        details: msg,
      });
    }
    return NextResponse.json({
      success: false,
      message: `HEC connection test failed: ${msg}`,
      details: msg,
    });
  }
}
