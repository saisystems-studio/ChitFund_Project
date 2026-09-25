import base64
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APIClient, APITestCase


class CompanyProfileTests(APITestCase):
    url = "/api/auth/company-profile/"

    def setUp(self):
        self.admin = User.objects.create_user("branding-admin", password="test-password", is_staff=True)
        self.client.force_authenticate(self.admin)

    def logo(self, extension="png", image_format="PNG"):
        data = BytesIO()
        Image.new("RGB", (20, 20), "blue").save(data, format=image_format)
        return SimpleUploadedFile(f"logo.{extension}", data.getvalue(), content_type=Image.MIME[image_format])

    def test_unconfigured_profile_is_public_and_empty(self):
        response = APIClient().get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"company_name": "", "logo": "", "address": "", "phone": "", "email": ""})

    def test_save_survives_new_client_and_login(self):
        response = self.client.patch(self.url, {"company_name": "  Example Company  ", "logo": self.logo()}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["company_name"], "Example Company")
        expected = response.data
        raw = base64.b64decode(expected["logo"].split(",", 1)[1])
        with Image.open(BytesIO(raw)) as image:
            self.assertEqual(image.format, "PNG")
        fresh = APIClient()
        self.assertEqual(fresh.get(self.url).data, expected)
        login = fresh.post("/api/auth/login/", {"username": "branding-admin", "password": "test-password"})
        self.assertEqual(login.status_code, 200)
        fresh.credentials(HTTP_AUTHORIZATION=f"Token {login.data['token']}")
        self.assertEqual(fresh.get(self.url).data, expected)

    def test_change_remove_and_reset_defaults(self):
        for extension, image_format in [("png", "PNG"), ("jpg", "JPEG"), ("jpeg", "JPEG")]:
            response = self.client.patch(self.url, {"company_name": "Example", "logo": self.logo(extension, image_format)}, format="multipart")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["logo"].startswith(f"data:image/{image_format.lower()};base64,"))
        preserved = response.data["logo"]
        self.assertEqual(self.client.patch(self.url, {"company_name": "Changed"}).data["logo"], preserved)
        response = self.client.patch(self.url, {"remove_logo": True}, format="json")
        self.assertEqual(response.data, {"company_name": "Changed", "logo": "", "address": "", "phone": "", "email": ""})
        self.client.patch(self.url, {"company_name": ""})
        self.assertEqual(APIClient().get(self.url).data, {"company_name": "", "logo": "", "address": "", "phone": "", "email": ""})

    def test_invalid_uploads_do_not_overwrite_saved_profile(self):
        self.client.patch(self.url, {"company_name": "Keep me"})
        invalid = [
            SimpleUploadedFile("fake.png", b"not an image", content_type="image/png"),
            self.logo("gif", "GIF"),
            self.logo("png", "GIF"),
            SimpleUploadedFile("huge.jpg", b"x" * (2 * 1024 * 1024 + 1), content_type="image/jpeg"),
        ]
        for logo in invalid:
            with self.subTest(filename=logo.name):
                response = self.client.patch(self.url, {"company_name": "Invalid", "logo": logo}, format="multipart")
                self.assertEqual(response.status_code, 400)
                self.assertIn("logo", response.data)
        self.assertEqual(APIClient().get(self.url).data["company_name"], "Keep me")
        self.assertEqual(self.client.patch(self.url, {"company_name": "x" * 201}).status_code, 400)

    def test_only_admin_can_update(self):
        self.assertIn(APIClient().patch(self.url, {"company_name": "Denied"}).status_code, (401, 403))
        self.client.force_authenticate(User.objects.create_user("staff-reader"))
        self.assertEqual(self.client.patch(self.url, {"company_name": "Denied"}).status_code, 403)

    @override_settings(DEBUG=True, TEMP_ADMIN_LOGIN_ENABLED=True, TEMP_ADMIN_USERNAME="temporary-branding", TEMP_ADMIN_PASSWORD="temporary-password")
    def test_temporary_admin_can_persist_profile(self):
        client = APIClient()
        login = client.post("/api/auth/login/", {"username": "temporary-branding", "password": "temporary-password"})
        client.credentials(HTTP_AUTHORIZATION=f"Token {login.data['token']}")
        self.assertEqual(client.patch(self.url, {"company_name": "Temporary admin saved"}).status_code, 200)
        self.assertEqual(APIClient().get(self.url).data["company_name"], "Temporary admin saved")
