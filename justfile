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
	pnpm run typecheck

alias t := test
# Run the tests
test:
	pnpm run test

alias i := integration
# Run the integration tests
integration:
	pnpm turbo run test:integration

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
