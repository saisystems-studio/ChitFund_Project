from collections import Counter

from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from rest_framework.response import Response

# Business names for the records that can block a delete.
USAGE_LABELS = {
    "collectiontransaction": ("collection", "collections"),
    "paymententry": ("payment entry", "payment entries"),
    "customerloandetails": ("loan", "loans"),
    "customerchitdetails": ("chit loan", "chit loans"),
    "mortgageloandetails": ("mortgage loan", "mortgage loans"),
    "interestdetails": ("interest loan", "interest loans"),
    "customerloaninstallmentdetails": ("loan installment", "loan installments"),
    "loanholidaysettings": ("loan holiday setting", "loan holiday settings"),
}


def _usage(objects):
    # A collection's installment split is part of the collection itself, so it is not listed separately.
    objects = [obj for obj in objects if obj._meta.model_name != "collectionallocation"] or objects
    counts = Counter(obj._meta.model_name for obj in objects)
    parts = []
    for model_name, count in counts.most_common():
        meta = next(obj._meta for obj in objects if obj._meta.model_name == model_name)
        singular, plural = USAGE_LABELS.get(model_name, (str(meta.verbose_name), str(meta.verbose_name_plural)))
        parts.append(f"{count} {singular if count == 1 else plural}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def delete_response(instance, label):
    """Delete a record, explaining in plain words why it cannot be deleted when it is referenced."""
    try:
        with transaction.atomic():
            instance.delete()
    except ProtectedError as error:
        objects = list(error.protected_objects)
        return Response({"detail": f"This {label} cannot be deleted because it is used in {_usage(objects)}."}, status=409)
    except IntegrityError:
        return Response({"detail": f"This {label} cannot be deleted because other records still refer to it."}, status=409)
    return Response(status=204)
