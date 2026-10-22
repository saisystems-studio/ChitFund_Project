export function newUploadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function savePendingDocuments(api, auth, root, pending) {
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index];
    const body = new FormData();
    body.append('document_type', item.documentType);
    if (item.uploadToken) body.append('upload_token', item.uploadToken);
    if (item.documentType === 'OTHER') body.append('other_document_name', item.otherName.trim());
    body.append('file', item.file, item.file.name);
    try { await api.post(root, body, auth); }
    catch (error) { return { remaining: pending.slice(index), error }; }
  }
  return { remaining: [], error: null };
}
