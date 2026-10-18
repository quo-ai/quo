import { useCallback, useState } from 'react';
import { Alert, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { ImageAttachment, DocumentAttachment } from '@/types/chat';
import { extractTextFromFile, isSupportedFileType } from '@/services/fileExtractor';

// Images are read fully into memory as base64 (~1.33x the file size) and
// then handed to the vision projector; documents are read fully for text
// extraction. Cap both before reading so a huge file can't OOM the JS heap.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Shared picker options. expo-image-picker has no resize option; the square
// crop + JPEG quality keep camera/library images small. base64 is read
// afterwards (after the size check) instead of returned by the picker.
const IMAGE_PICKER_OPTIONS = {
  allowsEditing: true,
  aspect: [1, 1] as [number, number],
  quality: 0.8,
  base64: false,
};

function isImageExtension(name: string): boolean {
  const match = name.match(/\.[^.]+$/);
  if (!match) return false;
  const ext = match[0].toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'].includes(ext);
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

class FileTooLargeError extends Error {}

async function resolveFileSize(uri: string, knownSize?: number | null): Promise<number | undefined> {
  if (typeof knownSize === 'number' && knownSize > 0) return knownSize;
  try {
    const info = await getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turn a picked image (camera, library or document picker) into an
 * attachment: size-check, read base64, and resolve dimensions if the picker
 * didn't supply them. Throws FileTooLargeError above MAX_IMAGE_BYTES.
 */
async function assetToImageAttachment(asset: {
  uri: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): Promise<ImageAttachment> {
  const size = await resolveFileSize(asset.uri, asset.fileSize);
  if (size !== undefined && size > MAX_IMAGE_BYTES) {
    throw new FileTooLargeError(
      `This image is ${formatMB(size)}. Please choose an image under ${formatMB(MAX_IMAGE_BYTES)}.`,
    );
  }

  const base64 = await readAsStringAsync(asset.uri, { encoding: 'base64' });

  let width = asset.width || 0;
  let height = asset.height || 0;
  if (!width || !height) {
    width = 1024;
    height = 1024;
    try {
      await new Promise<void>((resolve, reject) => {
        Image.getSize(asset.uri, (w, h) => {
          width = w;
          height = h;
          resolve();
        }, reject);
      });
    } catch {
      // keep defaults if sizing fails
    }
  }

  return {
    uri: asset.uri,
    width,
    height,
    base64,
    mimeType: asset.mimeType ?? undefined,
  };
}

// Image analysis is gated by model capability, not by premium: the free
// tier includes a vision model (Ministral 3B), so point users there
// instead of showing a paywall for something they can have for free.
function showVisionModelHint() {
  Alert.alert(
    'Vision Model Required',
    'To analyse images, switch to a vision-capable model in Settings. Ministral (3B) supports vision and is free to download.'
  );
}

/** Pending image/document attachment state plus the three pickers. */
export function useAttachments({ visionEnabled }: { visionEnabled: boolean }) {
  const [selectedImage, setSelectedImage] = useState<ImageAttachment | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentAttachment | null>(null);
  const [isExtractingText, setIsExtractingText] = useState(false);

  // One attachment at a time: an image replaces a document and vice versa.
  const attachImage = useCallback(async (
    asset: Parameters<typeof assetToImageAttachment>[0],
    failureMessage: string,
  ) => {
    try {
      setSelectedImage(await assetToImageAttachment(asset));
      setSelectedDocument(null);
    } catch (error) {
      if (error instanceof FileTooLargeError) {
        Alert.alert('Image Too Large', error.message);
      } else {
        console.error('Error reading image:', error);
        Alert.alert('Error', failureMessage);
      }
    }
  }, []);

  const pickImage = useCallback(async () => {
    try {
      if (!visionEnabled) {
        showVisionModelHint();
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photos to attach images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        ...IMAGE_PICKER_OPTIONS,
      });

      if (!result.canceled && result.assets[0]) {
        await attachImage(result.assets[0], 'Failed to pick image. Please try again.');
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  }, [visionEnabled, attachImage]);

  const takePhoto = useCallback(async () => {
    try {
      if (!visionEnabled) {
        showVisionModelHint();
        return;
      }

      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow camera access to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync(IMAGE_PICKER_OPTIONS);

      if (!result.canceled && result.assets[0]) {
        await attachImage(result.assets[0], 'Failed to take photo. Please try again.');
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  }, [visionEnabled, attachImage]);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const mime = asset.mimeType || 'application/octet-stream';
      const name = asset.name || 'document';

      if (mime.startsWith('image/') || isSupportedFileType(mime, name) === false && isImageExtension(name)) {
        if (!visionEnabled) {
          showVisionModelHint();
          return;
        }
        await attachImage(
          { uri: asset.uri, mimeType: mime, fileSize: asset.size },
          'Failed to read image file.',
        );
        return;
      }

      if (!isSupportedFileType(mime, name)) {
        Alert.alert(
          'Unsupported File',
          'This file type is not supported. You can attach text files (.txt, .md, .csv, .json, .xml, .html, .log, code files) and PDFs.',
        );
        return;
      }

      const size = await resolveFileSize(asset.uri, asset.size);
      if (size !== undefined && size > MAX_DOCUMENT_BYTES) {
        Alert.alert(
          'File Too Large',
          `This file is ${formatMB(size)}. Please attach a file under ${formatMB(MAX_DOCUMENT_BYTES)}.`,
        );
        return;
      }

      setIsExtractingText(true);
      try {
        const extractedText = await extractTextFromFile(asset.uri, mime, name);
        setSelectedDocument({
          uri: asset.uri,
          name,
          mimeType: mime,
          size: size || 0,
          extractedText,
        });
        // Remove image if a document is selected (one attachment at a time)
        setSelectedImage(null);
      } catch (error: any) {
        Alert.alert('Could Not Read File', error.message || 'Failed to extract text from this file.');
      } finally {
        setIsExtractingText(false);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    }
  }, [visionEnabled, attachImage]);

  const removeImage = useCallback(() => setSelectedImage(null), []);
  const removeDocument = useCallback(() => setSelectedDocument(null), []);
  const clearAttachments = useCallback(() => {
    setSelectedImage(null);
    setSelectedDocument(null);
  }, []);

  return {
    selectedImage,
    selectedDocument,
    isExtractingText,
    pickImage,
    takePhoto,
    pickDocument,
    removeImage,
    removeDocument,
    clearAttachments,
  };
}
