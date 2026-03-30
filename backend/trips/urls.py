from django.urls import path
from .views import PlanTripView, GeocodeView, HealthCheckView

urlpatterns = [
    path('trip/plan/', PlanTripView.as_view(), name='trip-plan'),
    path('geocode/',   GeocodeView.as_view(),  name='geocode'),
    path('health/',    HealthCheckView.as_view(), name='health'),
]
