# Run all
default: all

alias f := fmt
# Run fmt
fmt:
	pnpm run fmt

alias c := check
# Run checks
check:
	pnpm run fmt:check
	pnpm run lint
	pnpm run lint:effect
	pnpm run typecheck

alias t := test
# Run the tests
test:
	pnpm run test

alias i := integration
# Run the integration tests
integration workers="":
	if [ -n "{{workers}}" ]; then \
		pnpm turbo run test:integration -- --maxWorkers={{workers}}; \
	else \
		pnpm turbo run test:integration; \
	fi

alias b := build
# Build the project
build:
	pnpm run build

# run all
all: fmt check test build

alias d := demo
# Run demo app
demo:
	pnpm turbo run dev --filter=@xmux/demo
