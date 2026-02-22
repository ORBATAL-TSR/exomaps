# Dockerfile

# Pull base image
# FROM python:3.7

FROM ubuntu:18.04

MAINTAINER IONTOM "iontom@gmail.com"

RUN apt-get update -y && \
    apt-get install -y python3-pip \
    python3-dev python3-psycopg2

COPY ./requirements.txt /requirements.txt

WORKDIR /

RUN pip3 install -r requirements.txt

COPY . /

# Set environment variables
# ENV PYTHONDONTWRITEBYTECODE 1
# ENV PYTHONUNBUFFERED 1

VOLUME ["/code"]

# Set work directory
WORKDIR /code

# Install dependencies
# RUN pip install pipenv
# COPY Pipfile Pipfile.lock /code/
# RUN pipenv install --system

ENTRYPOINT [ "python3" ]
CMD [ "src/app/app.py" ]