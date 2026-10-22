from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import MortgageUqc


class MortgageUqcTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user("mortgage-admin", is_staff=True))
        self.url = "/api/finance/mortgages/uqcs/"

    def test_create_normalizes_and_persists_uqc(self):
        response = self.client.post(self.url, {"name": "kgx"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "KGX")
        self.assertTrue(MortgageUqc.objects.filter(name="KGX").exists())
        self.assertIn("KGX", self.client.get(self.url).data)

    def test_duplicate_is_case_insensitive_and_returns_existing_code(self):
        MortgageUqc.objects.create(name="BOX")
        response = self.client.post(self.url, {"name": "box"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "BOX")
        self.assertEqual(MortgageUqc.objects.filter(name__iexact="box").count(), 1)

    def test_invalid_uqc_is_rejected(self):
        response = self.client.post(self.url, {"name": " Other "}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_listing_normalizes_and_deduplicates_legacy_case_without_changing_records(self):
        from .models import Mortgage
        product=Mortgage.objects.create(product_name='Legacy Code',unit='Gram',uqc='kgs')
        codes=self.client.get(self.url).data
        self.assertEqual(codes.count('KGS'),1)
        product.refresh_from_db()
        self.assertEqual(product.uqc,'kgs')

    def test_product_add_edit_fetch_binds_all_tax_fields(self):
        payload={'product_group':'Gold','product_name':'Tax Product','hsn_code':' 7113 ','rate_of_tax':18,'unit':'Gram','uqc':'gms','current_rate':'500','rate_date':'2026-10-12'}
        added=self.client.post('/api/finance/mortgages/',payload,format='json')
        self.assertEqual(added.status_code,201,added.data)
        url=f"/api/finance/mortgages/{added.data['id']}/"
        data=self.client.get(url).data
        self.assertEqual((data['hsn_code'],data['rate_of_tax'],data['unit'],data['uqc']),('7113',18,'Gram','GMS'))
        edited=self.client.patch(url,{'hsn_code':'7114','rate_of_tax':5,'unit':'Pcs','uqc':'nos'},format='json')
        self.assertEqual(edited.status_code,200,edited.data)
        data=self.client.get(url).data
        self.assertEqual((data['hsn_code'],data['rate_of_tax'],data['unit'],data['uqc']),('7114',5,'Pcs','NOS'))

    def test_required_tax_fields_and_rates(self):
        payload={'product_group':'Gold','product_name':'Invalid Tax','hsn_code':'7113','rate_of_tax':18,'unit':'Gram','uqc':'GMS','current_rate':'500','rate_date':'2026-10-12'}
        for field,value in [('uqc',''),('unit',''),('rate_of_tax',7)]:
            response=self.client.post('/api/finance/mortgages/',{**payload,field:value},format='json')
            self.assertEqual(response.status_code,400,(field,response.data))
        # HSN Code / Rate of Tax moved to Group & Ledger Master: no longer required on a product.
        response=self.client.post('/api/finance/mortgages/',{**payload,'hsn_code':''},format='json')
        self.assertEqual(response.status_code,201,response.data)

    def test_legacy_partial_edit_preserves_blank_tax_fields_and_normalizes_display_only(self):
        from .models import Mortgage
        blank=Mortgage.objects.create(product_name='Legacy Blank',unit='Gram')
        url=f'/api/finance/mortgages/{blank.pk}/'
        response=self.client.patch(url,{'quantity':'2'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        blank.refresh_from_db()
        self.assertEqual((blank.hsn_code,blank.uqc),('',''))
        old=Mortgage.objects.create(product_name='Legacy Lowercase',unit='Gram',hsn_code='7113',uqc='kgs')
        url=f'/api/finance/mortgages/{old.pk}/'
        self.assertEqual(self.client.get(url).data['uqc'],'KGS')
        self.assertEqual(self.client.patch(url,{'quantity':'3'},format='json').status_code,200)
        old.refresh_from_db()
        self.assertEqual(old.uqc,'kgs')
