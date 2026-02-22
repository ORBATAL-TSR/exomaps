FROM python:3
MAINTAINER iontom

ENV PYTHONUNBUFFERED 1
RUN mkdir -p /opt/services/database
#VOLUME ["/opt/services/database"]
# We copy the requirements.txt file first to avoid cache invalidations
COPY requirements.txt /opt/services/database
WORKDIR /opt/services/database
RUN pip install -r requirements.txt
COPY . /opt/services/database
EXPOSE 5090
CMD ["python", "database.py"]