from customers.kyc_security import create_kyc_document
from finance.serializers import LoanKycDocumentSerializer

from .models import StaffKycDocument


# Kept out of staff/serializers.py because finance.serializers imports that module
# (DoneBySerializerMixin); importing finance.serializers there would be circular.
class StaffKycDocumentSerializer(LoanKycDocumentSerializer):
    """Same file validation, OTHER-name rule and retry-safe upload_token handling as
    loan KYC documents. The owning staff is never read from the body: the view supplies it."""

    class Meta(LoanKycDocumentSerializer.Meta):
        model = StaffKycDocument

    def create(self, validated_data):
        return create_kyc_document(StaffKycDocument, validated_data)
