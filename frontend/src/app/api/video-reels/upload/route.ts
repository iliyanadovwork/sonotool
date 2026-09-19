import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // You could add authentication here if needed
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/*'],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[Vercel Blob] Upload completed:', blob.url);
        // You could store metadata in your database here
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error: unknown) {
    console.error('[Vercel Blob] Upload error:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : '') || 'Upload failed' },
      { status: 400 }
    );
  }
}
