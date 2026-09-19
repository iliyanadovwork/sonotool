import { google } from 'googleapis';

// Folder name for storing uploaded videos
const SONOREELS_FOLDER_NAME = 'Sonoreels Uploads';

interface UploadResult {
  fileId: string;
  downloadUrl: string;
}

/**
 * Find or create the Sonoreels Uploads folder in Google Drive
 */
async function findOrCreateFolder(accessToken: string): Promise<string> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  // First, try to find existing folder
  try {
    const response = await drive.files.list({
      q: `name='${SONOREELS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (response.data.files && response.data.files.length > 0) {
      console.log('[Drive] Found existing folder:', response.data.files[0].id);
      return response.data.files[0].id!;
    }
  } catch (error) {
    console.error('[Drive] Error searching for folder:', error);
  }

  // Create the folder if not found
  try {
    const response = await drive.files.create({
      requestBody: {
        name: SONOREELS_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    const folderId = response.data.id;
    console.log('[Drive] Created new folder:', folderId);
    return folderId!;
  } catch (error) {
    console.error('[Drive] Error creating folder:', error);
    throw new Error('Failed to create Sonoreels folder in Google Drive');
  }
}

/**
 * Upload a video file to Google Drive
 * @param file - The file to upload (File, Blob, or Buffer)
 * @param filename - The name for the file in Drive
 * @param accessToken - Google OAuth access token
 * @returns The file ID and download URL
 */
export async function uploadVideo(
  file: File | Blob | Buffer,
  filename: string,
  accessToken: string
): Promise<UploadResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  // Find or create the Sonoreels folder
  const folderId = await findOrCreateFolder(accessToken);

  // Determine file size
  let fileSize: number;
  if (file instanceof File) {
    fileSize = file.size;
  } else if (file instanceof Blob) {
    fileSize = file.size;
  } else {
    fileSize = file.length;
  }

  console.log(`[Drive] Uploading video: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

  // For large files (>5MB), use resumable upload
  const useResumable = fileSize > 5 * 1024 * 1024;

  try {
    // Regular upload (works for all file sizes)
    const media = {
      mimeType: 'video/mp4',
      body: file, // googleapis accepts File, Blob, or ReadableStream
    };

    const response = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
        mimeType: 'video/mp4',
      },
      media: media,
      fields: 'id',
    });

    const fileId = response.data.id!;
    console.log('[Drive] Upload complete, file ID:', fileId);

    // Set the file to be publicly accessible
    await setPublicSharing(fileId, accessToken);

    // Generate the download URL
    const downloadUrl = getDownloadUrl(fileId);

    return { fileId, downloadUrl };
  } catch (error) {
    console.error('[Drive] Upload error:', error);
    throw new Error(`Failed to upload video to Drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Set a file's sharing permissions to "anyone with link can view"
 */
export async function setPublicSharing(fileId: string, accessToken: string): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    console.log('[Drive] Set public sharing for file:', fileId);
  } catch (error) {
    console.error('[Drive] Error setting public sharing:', error);
    // Don't throw - the upload still succeeded, just the sharing failed
  }
}

/**
 * Generate a direct download URL for a Drive file
 */
export function getDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Delete a file from Google Drive
 */
export async function deleteVideo(fileId: string, accessToken: string): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.files.delete({
      fileId: fileId,
    });
    console.log('[Drive] Deleted file:', fileId);
  } catch (error) {
    console.error('[Drive] Error deleting file:', error);
    throw new Error(`Failed to delete video from Drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
