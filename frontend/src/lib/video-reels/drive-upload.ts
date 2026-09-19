// Upload a file directly to Google Drive from the browser
// This bypasses Vercel's size limits by using the Google Drive API directly

import { fetchWithTimeout } from '@/lib/video-reels/fetch-timeout';

export interface DriveUploadResult {
  fileId: string;
  downloadUrl: string;
  webViewLink: string;
}

export async function uploadToGoogleDrive(
  file: File,
  accessToken: string,
  fileName?: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<DriveUploadResult> {
  const filename = fileName || file.name;

  // Step 1: Initiate resumable upload session
  const initUrl = new URL('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
  const initResponse = await fetchWithTimeout(initUrl.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: filename,
      mimeType: file.type,
      // Make file publicly viewable
      visibility: 'anyone_with_link',
    }),
  });

  if (!initResponse.ok) {
    const error = await initResponse.text();
    throw new Error(`Failed to initiate upload: ${error}`);
  }

  // Get the resumable upload URL from the Location header
  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('No upload URL received from Google Drive');
  }

  // Step 2: Upload the file using the resumable upload URL.
  // Larger timeout (30s) since this transfers the full file payload.
  const uploadResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        'Content-Length': file.size.toString(),
      },
      body: file,
    },
    30000
  );

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Failed to upload file: ${error}`);
  }

  const fileData = await uploadResponse.json();

  // Step 3: Set permissions to make the file publicly accessible
  const fileId = fileData.id;
  const permissionUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`);
  await fetchWithTimeout(permissionUrl.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone',
    }),
  });

  // Step 4: Get the file with webViewLink
  const fileUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`);
  const fileResponse = await fetchWithTimeout(fileUrl.toString(), {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!fileResponse.ok) {
    throw new Error('Failed to get file details');
  }

  const fileDetails = await fileResponse.json();

  // Generate direct download URL
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  return {
    fileId,
    downloadUrl,
    webViewLink: fileDetails.webViewLink,
  };
}
