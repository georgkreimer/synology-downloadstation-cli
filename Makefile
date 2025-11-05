.PHONY: build release run test clean install

PREFIX ?= /usr/local
DESTDIR ?=

build:
	swift build

release:
	swift build -c release

run:
	swift run synology-ds -- $(ARGS)

test:
	swift test

install:
	install -d $(DESTDIR)$(PREFIX)/bin
	install .build/release/synology-ds $(DESTDIR)$(PREFIX)/bin/synology-ds

clean:
	swift package clean
	rm -rf .build
