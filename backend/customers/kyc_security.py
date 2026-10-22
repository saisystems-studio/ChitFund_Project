"""Shared validation, storage and permissions for customer and loan ID documents."""
import os
from pathlib import Path
import warnings
import hashlib

from PIL import Image
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework.permissions import BasePermission

from accounts.permissions import is_admin_user


class CanAccessKycDocuments(BasePermission):
    message = 'KYC documents require administrator or entry access.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (
            is_admin_user(user) or getattr(getattr(user, 'profile', None), 'can_write', False)))


class PrivateKycStorage(FileSystemStorage):
    @property
    def location(self):
        private = Path(getattr(settings, 'KYC_PRIVATE_ROOT', settings.BASE_DIR / 'private_kyc')).resolve()
        media = Path(settings.MEDIA_ROOT).resolve()
        if private == media or media in private.parents:
            raise ValueError('KYC_PRIVATE_ROOT must be outside MEDIA_ROOT.')
        return str(private)

    def url(self, name):
        raise ValueError('Private KYC documents have no public URL.')

    def _open(self, name, mode='rb'):
        try:
            return super()._open(name, mode)
        except FileNotFoundError:
            # Read existing attachments in place. Never move or rewrite prior files.
            return FileSystemStorage(location=settings.MEDIA_ROOT).open(name, mode)


def private_kyc_storage():
    return PrivateKycStorage(file_permissions_mode=0o600, directory_permissions_mode=0o700)


def validate_kyc_file(upload):
    expected = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.webp': 'image/webp', '.pdf': 'application/pdf'}
    extension = os.path.splitext(upload.name)[1].lower()
    mime = expected.get(extension)
    if not mime or (upload.content_type and upload.content_type != mime):
        raise serializers.ValidationError('Only matching JPG, PNG, WEBP or PDF files are allowed.')
    if not 0 < upload.size <= 5 * 1024 * 1024:
        raise serializers.ValidationError('File must be nonempty and at most 5 MB.')
    try:
        if mime == 'application/pdf':
            if not upload.read(8).startswith(b'%PDF-'):
                raise ValueError('Invalid PDF header')
            upload.seek(max(0, upload.size - 1024))
            if b'%%EOF' not in upload.read():
                raise ValueError('Incomplete PDF')
        else:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(upload) as image:
                    if Image.MIME.get(image.format) != mime:
                        raise ValueError('Image format does not match extension')
                    image.verify()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise serializers.ValidationError('Invalid or damaged document content.') from error
    finally:
        upload.seek(0)
    upload.content_type = mime
    return upload


def create_kyc_document(model, validated_data):
    from .models import CustomerDocumentType
    upload = validated_data.pop('file')
    instance = model(**validated_data, original_file_name=os.path.basename(upload.name),
                     file_type=upload.content_type, file_size=upload.size)
    def existing_upload():
        if not instance.upload_token:
            return None
        existing = model.objects.filter(upload_token=instance.upload_token).first()
        if existing is None:
            return None
        # A model owned by more than one parent kind declares them (e.g. receipt or payment).
        parent_fields = getattr(model, 'kyc_parent_fields', None) or (
            ('customer_id',) if hasattr(instance, 'customer_id') else ('loan_id',))
        if (any(getattr(existing, field) != getattr(instance, field) for field in parent_fields)
                or existing.document_type != instance.document_type
                or existing.other_document_name != instance.other_document_name
                or existing.file_size != upload.size):
            raise serializers.ValidationError({'upload_token': 'Upload token is already used for another document.'})
        upload.seek(0)
        with existing.file.open('rb') as saved:
            same = hashlib.sha256(saved.read()).digest() == hashlib.sha256(upload.read()).digest()
        upload.seek(0)
        if not same:
            raise serializers.ValidationError({'upload_token': 'Upload token is already used for different content.'})
        return existing
    existing = existing_upload()
    if existing:
        return existing
    try:
        with transaction.atomic():
            instance.file.save(upload.name, upload, save=False)
            instance.save()
            name = instance.other_document_name.strip()
            if instance.document_type == 'OTHER' and name:
                CustomerDocumentType.objects.get_or_create(name__iexact=name, defaults={'name': name})
    except Exception as error:
        if instance.file.name:
            instance.file.storage.delete(instance.file.name)
        if isinstance(error, IntegrityError):
            existing = existing_upload()
            if existing:
                return existing
        raise
    return instance


def secure_kyc_response(response):
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
