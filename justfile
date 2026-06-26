# Run all
default: all

alias f := fmt
# Run fmt
fmt:
	@pnpm exec oxfmt

alias c := check
# Run checks
check:
	@pnpm exec oxfmt --check
	@pnpm exec oxlint
	@pnpm turbo run lint:effect --output-logs=errors-only --log-order=grouped
	@pnpm turbo run typecheck --output-logs=errors-only --log-order=grouped

alias t := test
# Run the tests
test:
	@pnpm turbo run test --output-logs=errors-only --log-order=grouped

alias i := integration
# Run the integration tests
integration workers="":
	@if [ -n "{{workers}}" ]; then \
		pnpm turbo run test:integration --output-logs=errors-only --log-order=grouped -- --maxWorkers={{workers}}; \
	else \
		pnpm turbo run test:integration --output-logs=errors-only --log-order=grouped; \
	fi

alias b := build
# Build the project
build:
	@pnpm turbo run build --output-logs=errors-only --log-order=grouped

# run all
all: fmt check test build

alias d := demo
# Run demo app
demo:
	pnpm turbo run dev --filter=@xmux/demo
